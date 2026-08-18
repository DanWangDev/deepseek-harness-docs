# Agentic Loop：自主循环的核心机制

> 深入解析 DeepSeek Harness 的 agent loop 驱动器（`packages/core/agent-loop`）——从 inbox 认领、提示词组装、流式模型调用、工具执行到终止判定的完整状态机，基于事件目录与类型声明的源码级分析。

## 什么是 Agentic Loop

传统聊天机器人：你问一句，它答一句。DeepSeek Harness 不一样：你说一个需求，它可能连续执行多步操作才给你最终结果。

这背后的机制叫 **Agentic Loop**。dsh 的循环不叫 `while(true)`——它被建模为**事件驱动的轮次排空**：

* **步骤（step）**：一次模型请求，以及由模型响应引发的工具执行
* **轮次（turn）**：会话中一次对已接纳输入的排空过程，包含零个或多个步骤；在模型及其工具停止工作或终止策略介入后结束

一个轮次在领取首条输入之前打开，并在不再欠下任何工作时关闭。**轮次与步骤的边界是持久会话事件**（`turn/start`、`step/start`……），而不是实时 emit——因此崩溃后可以从日志重建循环的完整轨迹。

## 循环的完整结构

驱动器（`ctx.agentLoop`）在 `ctx.agents.withInitiator()` 内运行，一次典型轮次包含以下阶段：

```text
① inbox 认领
   claim(target)：取出全部 next-step 输入 + 轮次边界上的一条 next-turn 消息
   → agent/pre-step（waterfall）：reject 或 enter(messages)

② 提示词组装
   ctx.systemPrompt 拼接提示词段落（PromptSection）
   + ctx.tools.schemas(scope) 工具 schema 允许列表
   → request/header 事件：完整请求信封写入日志

③ 历史派生
   从会话日志 deriveMessages() 投影模型历史（surface 是唯一来源）

④ 流式模型调用
   agent/request（waterfall，可替换冻结的调用配置）
   → llm/stream → assistant/chunk*（原始分片）→ assistant/message（组装后消息）

⑤ 工具执行
   tool/call* → tools/pre-execute（allow/deny/ask）
   → ToolGuard（单调 guard）→ tools/execute（环绕分派）
   → tools/post-execute（检查/替换结果）→ tool/result*

⑥ 继续或终止
   工具还欠另一个请求？next-step 输入已到达？→ 认领 → 下一个 step
   否则 → agent/turn-stopping（serial）→ turn/end
```

## 阶段详解

### 阶段 1：Inbox 认领与 pre-step 决策

输入通过同一个 inbox 到达驱动器。有些消息会立即唤醒它；注入的上下文会留在 inbox 中，直到另一条消息将其唤醒。inbox 是**两条有序的待处理消息列表**（持久投影）：

```ts
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

`claim(target)` 通过纯删除 splice 移除拟进入步骤的批次——**全部 `next-step` 输入，外加轮次边界上的一条 `next-turn` 消息**——并逐条发出 `agent/inbox/claimed` 通知。

`agent/pre-step` 是请求推导前唯一的串行监听器链，决定模型看到什么：

```ts
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

监听器可以改写已领取的消息，也可以直接拒绝它们；首次领取被拒绝或被改写为空时，仍会关闭一个不含步骤的持久轮次——日志会记录这次尝试。步骤准入也接受**工具 continuation**：工具在步骤之间可以提交空的已领取批次，让循环继续而不引入新输入。

### 阶段 2：提示词组装与请求头

每个步骤读取插件注册的提示词片段（`PromptSection`，按 `order` 升序拼接）和工具 schema（`ctx.tools.schemas()` 的白名单投影）。组装结果连同调用配置一起作为 **`request/header` 事件**写入日志——`EpochHeader` 包含调用配置、适配器默认值、渲染后的系统提示词与已组装的工具 schema。**每个对话请求都是日志的纯函数**。

### 阶段 3：历史派生

模型历史**从不单独存储**——`Session.deriveMessages()` 从会话日志的 surface 投影派生。`user/message` 携带确切内容；`assistant/message` 是权威的组装消息（原始 `assistant/chunk` 在派生时跳过，仅用于回放/UI 保真）；`tool/result` 投影为带 `tool-result` 块的 user 消息。

### 阶段 4：流式模型调用

`agent/request` 是 waterfall：`await next()` 得到机器将使用的调用配置（首次请求用 agent options，其后用已记录的 header），返回替换即可切换。**模型可见内容必须使用已记录通道——这个 waterfall 不能改写消息**。

`llm/stream` 返回原始 `StreamChunk` 协议（封闭的可辨识联合，`switch` 以 `assertNever` 结尾）：`block-start`、`text-delta`、`reasoning-delta`、`tool-call-delta`、`block-end`（携带完整组装好的 `ContentBlock`）、`usage`、`finish`。适配器抛出的异常会被规范化为终态 `error` 或 `aborted` finish。

### 阶段 5：工具执行

工具调用从 `tool/call` 事件开始（`callId` 配对调用与结果，`arguments` 是模型产出的原始 JSON 字符串），经完整流水线：

```text
tools/pre-execute (waterfall)   → allow | deny | ask（approval 服务裁决）
ToolGuard（单调）                → 返回 reason 即拒绝；无法撤销
tools/execute (waterfall)       → 环绕分派：超时、重试、指标
tools/post-execute (waterfall)  → accept | replace | block
finalizeContent（工具自有）      → 最后一英里内容变换
tools/result (emit)             → 冻结的最终结果，观察者无法变换
```

执行调度有两种模式：`parallel`（可与兄弟调用重叠，需工具声明 `isConcurrencySafe`）与 `exclusive`（单独运行，形成排序屏障）。

## 终止条件

轮次以 `TurnEndReason` 结束（可合并扩展的 sum type）：

| 原因 | 含义 |
|---|---|
| `completed` | 正常完成：工具不再欠请求，没有新的输入 |
| `aborted` | 取消请求中断了活跃轮次（`{ kind: 'user' | 'parent' | 'hook' | 'disposed' }`） |
| `blocked` | 被阻塞 |
| `error` | 轮次失败；`error` 是结构化失败（`LlmError` 事实原样，或扁平化的 `UNKNOWN`） |
| `max-tokens` | 至少一个步骤达到输出 token 上限——即使之后继续执行，截断事实仍优先 |
| `interrupted` | 持久化后端在 reload 时关闭崩溃遗留的轮次（唯一不由 loop 发出的原因） |

## 取消与错误恢复

`Agent.cancel(cause, options)` 是唯一的取消入口：清除排队与 steering 工作（除非 `keepInbox`），中止活跃轮次。cause 是 TypeScript 强制的同进程输入；持久 `turn/end` 只保留粗粒度的 `{ kind: 'aborted' }`。

`agent/request-error` 在失败的模型步骤关闭之后、轮次关闭之前运行：listener 返回 `{ kind: 'retry' }` 且不调用 `next()` 即可拥有恢复；默认 `undefined` 让失败保持终态。

## 为什么轮次边界是持久的

轮次与步骤边界是**持久会话事件**而不是 agent emit，这让整个系统获得三个性质：

* **崩溃可恢复**：`interrupted` 由持久化后端在 reload 时合成，事件在崩溃前保持完整
* **回放即重现**：任何 UI 都可以从日志重建完整轨迹，无需实时镜像
* **模型可见即已记录**：循环搬运的每个事实都以事件落盘，运行时不变量可机械校验

## 下一站

循环搬运的对话词汇（`Message`、`ContentBlock`、`StreamChunk`）由 `packages/llm` 声明；循环写入的日志由[会话日志](../core/session.md)定义——那是理解"记忆从哪来"的下一站。
