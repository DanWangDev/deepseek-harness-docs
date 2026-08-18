# 会话日志：事件溯源的唯一真源

> `Session` 是一份由类型化 `SessionEvent` 组成的**仅追加日志**，是 agent 完整交互历史的唯一真源。LLM 消息历史从日志*派生*而来，从不单独存储——回放即从同一组事件重新派生。

## 事件溯源模型

DeepSeek Harness 的会话不是"消息数组"，而是一份**事件日志**：

* 每个条目携带单调的 `seq`（`seq = log.length`）、`time`（epoch 毫秒）与按 `type` 判别的 `data` payload
* 事件是**无损 JSON**——`Session.append` 在源头强制这一要求，错误事件绝不会进入日志
* 日志只增不改：模型历史、UI 回放、fork、恢复、transcript、遥测全部派生自同一事件流

持久化后端（JSONL / SQLite）无损保存每个事件，**包括** `assistant/chunk` 原始分片——`seq` 必须连续，因此不能从规范日志中过滤分片。

## `SessionEventMap`：事件词汇

核心会话事件（可通过声明合并扩展——插件通过 `declare module` 添加额外事件类型）：

| 事件 | payload | 作用 |
|---|---|---|
| `turn/start` | `{ turn }` | 打开轮次；拒绝、空输入、取消或失败可能让它无步骤关闭 |
| `turn/end` | `{ turn, reason }` | 以 `TurnEndReason` 关闭轮次 |
| `step/start` / `step/end` | `{ turn, step }` | 打开/关闭一个步骤（一次模型调用 + 它请求的工具执行） |
| `user/message` | `UserMessage` | 用户角色消息：直接提示词、`agent.inject()` 注入上下文、目标续行轮次 |
| `assistant/chunk` | `{ turn, step, chunk }` | 原始流式分片——token 级回放保真 |
| `assistant/message` | `{ turn, step, message, usage? }` | 组装后的 assistant 消息（派生历史使用它）；携带该步骤的 token 记账 |
| `tool/call` | `{ turn, step, callId, name, arguments }` | 模型请求一次工具调用；`arguments` 是模型产出的原始 JSON 字符串（未解析） |
| `tool/result` | `{ turn, step, message, error?, meta? }` | 完成的工具调用的模型可见结果 + 可选内部失败身份 + 工具私有 `meta` |
| `todo/write` | `{ todos }` | 全量列表快照；latest-write-wins |
| `request/header` | `{ header, reason }` | 下次请求的完整信封（调用配置 + 系统提示词 + 工具 schema） |
| `request/context` | `RequestContext` | 请求解析到的路由的上下文元数据（仅路由或容量变化时记录） |
| `session/end-seed` | `{}` | 标记构造种子结束；之前的 seq 来自 seed（恢复/fork/回放） |

三个产生消息的**surface 事件**（`user/message`、`assistant/message`、`tool/result`）携带 `surfaceOp` 与 `sourceEventSeqs`——它们声明自己如何加入有序的派生 surface：

```ts
/** How a session event entered the ordered surface. */
type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }
```

`append` 是常规尾部追加；`replace` 遮蔽从 `start` 到 `end`（含两端）的 surface 条目并在原位置插入新事件——这是压缩（compaction）执行 surface 变更的唯一方式。

## 派生历史：模型看到什么

`Session.deriveMessages()` 将事件日志投影为模型看到的 `Message[]`。投影规则：

| 事件 | 投影 |
|---|---|
| `user/message` | 携带确切 `content` 的 user 消息 |
| `assistant/message` | 一条 assistant 消息，包含生成它的提供方和模型；**内容为空的消息跳过**（被 max-tokens 截断且无内容的步骤仍记录事件以保存用量） |
| `tool/result` | 携带 `tool-result` 块的 user 消息 |
| 其余事件（`turn/*`、`step/*`、chunk） | 结构信息，不投影为消息 |

投影是**缓存且冻结**的：每个 surface 节点首次出现时投影一次，surface 重写触发重建；返回的 `Message` 对象共享且深冻结，通过投影修改已记录历史在类型上不可表达。

## 请求头：日志是纯函数

请求信封（`EpochHeader`）作为会话状态写入日志：

```ts
/** Logged request state outside derived history: call config, system prompt, and tools. */
interface EpochHeader {
  /** The conversation's call configuration (provider, model, reasoning effort, and sampling scalars). */
  config: LlmCallConfig
  /** Effective config fields materialized from the exact adapter rather than proposed by a caller. */
  adapterDefaults?: LlmCallConfigAdapterDefaults
  /** Rendered system prompt text; absent for a system-less request. */
  system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  tools?: ToolSchema[]
}
```

带 reason `'initial'` 或 `'resume'` 的完整快照记录每个 agent loop 实例的边界；之后请求变化时以 reason `'change'` 记录另一份完整快照。**每个对话请求都是日志的纯函数**——`foldRequestHeader(events)` 通过选择最新快照重建请求头。

## 轮次的结束原因

```ts
/** Why a turn ended. Merge-extensible sum type. */
interface TurnEndReasonMap {
  completed: { kind: 'completed' }
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause }
  blocked: { kind: 'blocked' }
  error: { kind: 'error'; error: LlmFailure }
  'max-tokens': { kind: 'max-tokens' }
  interrupted: { kind: 'interrupted' }
}
```

`max-tokens` 与模型调用中同名的 `FinishReason` 对应：只要轮次内有任何步骤以 `max-tokens` 结束，整个轮次就以 `max-tokens` 结束——截断事实优先于 `completed`。`interrupted` 是唯一不会由任何 loop 发出的原因：它由崩溃恢复合成。

## Fork：会话的派生

`ctx.sessions.fork(source, boundary?, childSessionId?)` 是活跃会话 fork 的策略 API：

* 选取到 `boundary` seq（含）为止的源事件（默认为当前最后一个事件）
* **要求所选前缀结束时没有开放轮次**——API 拒绝结束于开放轮次内的前缀，而不是静默截断
* 创建活跃子会话，包含深克隆的种子事件和子会话元数据（`parentSession`、`seedLength` 及继承的 `cwd`）

fork 出的子会话会追加 `session/end-seed` 标记自己的种子边界——在它之前的事件具有更小的 seq，且来自种子，属于一个已结束的生命周期。

## 执行封闭与独立事件

一个轮次包围一次模型循环执行，而不是整个会话日志。插件所属的纯日志事件（如 `compaction/*`、`hook/invoked`）可以出现在 `turn/end` 与下一个 `turn/start` 之间——占用事件 seq 但不递增轮次编号。需要即时持久性屏障的生产方会显式等待 `ctx.sessions.flush(session)`。

可选的 `dsh-session/invariant` 配套插件强制核心拥有的关系：轮次与步骤编号、执行事件封闭、同一步骤内工具调用/结果配对。

## 模型可见即已记录

这是会话日志设计的**运行时不变量**：抵达模型请求的一切都必须能从日志重建。因此新增一项模型可见输入就需要新增一个会话事件——扩展 `SessionEventMap` 并从日志渲染。新事件若未被识别且没有 `ignorable: true` 标记，读取方**必须拒绝**重建会话，而不是静默丢弃。
