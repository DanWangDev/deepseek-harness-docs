# 审批模型：ask/never 决策

> 详解 DeepSeek Harness 的用户审批 seam（`packages/interaction/user-approval`）：每次工具调用如何经过 `tools/pre-execute` 裁决、`ask`/`never` 策略如何按会话生效、审计事件对如何落盘——以及"不可绕过"的设计保证。

## 一个核心问题

用户审批 seam 回答一个问题：**这个具体操作是否可以继续？** 它拥有共享的请求/结果词汇、`ctx.approval` 分发服务、`approval/request` 应答者 waterfall、仅记录日志的审计事件对，以及按会话的 `ask`/`never` 策略。

调用方（如 `dsh-tools` 和 `dsh-tool-bash`）消费闭合的结果，**除非结果为 `allowed-once`，否则一律拒绝**（fail closed）。

## 结果词汇：闭合且失败即拒绝

```ts
/** Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn request, or unavailable answerer. */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

* `allowed-once` 仅授权所询问的那**一个**操作
* 调用方对 `rejected`、`cancelled` 和 `unavailable` 均执行拒绝
* **缺失、不负责该请求、抛异常或不合规的应答者都会产生 `unavailable`，而非放行**

每个请求获得全新的 `ApprovalRequestId`——品牌化 id 将 `approval/asked` 与 `approval/decided` 审计事件配对，同时不让审批 id 与工具调用 id 互换。

## 按会话策略：ask / never

```ts
/** A session's approval policy — what happens to an ask BEFORE any interactive answerer sees it. */
type ApprovalPolicy = 'ask' | 'never'
```

| 策略 | 行为 | 适用 |
|---|---|---|
| `ask`（默认） | 委托给组合的应答者链；无应答者时 fall through 到 fail-closed `unavailable` | 交互式使用 |
| `never` | 确定性返回 `rejected`，不分发任何应答者 | CI、无人值守、严格 headless |

生效值为**会话日志中最后一条 `approval/policy` 事件**，回退到服务配置——`setApprovalPolicy(session, policy)` 是唯一的写入路径，因此回放能重建覆盖值。

## 请求与裁决流程

```ts
/** Readonly same-process permission question. callId links to an already presented tool call. */
interface ApprovalRequest {
  readonly agent: Agent
  readonly toolName: string
  readonly callId?: CallId
  readonly reason?: string
  readonly signal?: AbortSignal
}
```

`ctx.approval.request(req)` 的完整流程：

```text
要求：发起请求的会话处于一个尚未结束的轮次内
  → 追加 approval/asked（审计）
  → never 策略？→ 确定性 rejected（在 waterfall 分发之前！）
  → approval/request waterfall：应答者链
     第一个应答者返回结果（否则调用 next() 委托）
  → 追加 approval/decided（审计，配对）
  → 以该结果完成
```

**`never` 在服务内部、waterfall 分发之前强制执行**——即使后来以 `prepend` 注册的应答者也无法绕过它。

## 与工具流水线的衔接

`tools/pre-execute` 的 `ask` 决策调用审批服务：

```text
tools/pre-execute (waterfall)
  → { kind: 'ask', reason } → ctx.approval.request({ agent, toolName, callId, reason })
      → allowed-once → 继续执行
      → rejected / cancelled / unavailable → 物化为 deny 错误结果
  → ToolGuard（单调）仍可施加最终拒绝
```

审批请求**刻意省略工具参数**：应答者通过 `callId` 将提示附加到已流式输出的工具调用上，而非渲染另一份可能漂移的副本。

## 审计：ask/decided 事件对

* 审计事件仅写入日志，**不进入模型 transcript**
* 模型可见的行为是调用方派生的工具结果与当前运行时上下文快照
* 两种策略都会把各自的完整当前含义贡献给**缓存安全的运行时上下文快照**——审批状态变化时，会在保留的历史后追加一份新的完整快照，而不改写请求头中的系统提示词

## 权限预设：把两个旋钮捆成一个

`dsh-permission-presets`（`ctx.permissionPresets`）把两个独立强制执行的旋钮——沙箱模式 `sandbox/mode` 与审批策略 `approval/policy`——捆成具名预设：

| 预设 | sandbox | approval |
|---|---|---|
| `workspace-write`（默认） | `workspace-write` | `ask` |
| `danger-full-access` | `danger-full-access` | `never` |
| `custom`（保留名） | 派生出的非预设状态 | — |

预设不拥有强制执行——执行/提示词叙述/回放仍读各自旋钮；`set(session, name)` 只记意图并**经各旋钮自己的 setter 写入**，因此回放无需追赶状态。要求施加隔离的 `ctx.shell` 执行器 + `ctx.approval`；配置错误在插件加载时即失败。

## 与参考实现的对比

Claude Code 的权限模型是 Allow/Ask/Deny 三级体系 + 五层规则来源 + Denial Tracking 死循环防护。DeepSeek Harness 的模型更简但更强：

| 维度 | Claude Code | dsh |
|---|---|---|
| 决策 | allow / ask / deny | allowed-once / rejected / cancelled / unavailable |
| 规则来源 | 8 个来源按优先级合并 | 会话策略（ask/never）+ 组合配置 |
| 不可绕过性 | 规则可被更高优先级覆盖 | 单调 guard：deny 无法被翻回 allow |
| 审计 | settings 写入 + 会话记录 | `approval/asked` + `approval/decided` 事件对（可回放） |
