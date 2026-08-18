# 子 Agent：委派与编排

> 从源码角度解析 DeepSeek Harness 的 subagent seam：一个 agent 如何将工作委派给子 agent，单次启动与可继续后台子 agent 的生命周期差异，以及 `send_message`/`interrupt_agent`/`list_agents` 控制工具的运作方式。

## 能力定位

subagent seam 让一个 agent 将工作委派给子 agent。与 bash 一样，它是**一项可选能力**，不属于 agent loop——但不同于其他能力 seam：**同一上下文中可共存多个提供方实现**，并按名称注册（`ctx.subagents`），而 bash 只允许一个执行器。

| 角色 | 包 |
|---|---|
| Service Definition | `dsh-subagent`（`ctx.subagents` + 词汇） |
| Service Provider（六个） | `dsh-subagent-spawn-in-process`、`-fork`、`-acp`、`-codex`、`-claude-code`、`-dsh-sdk` |
| Consumer | `dsh-tool-subagent`（委派）、`dsh-tool-subagent-control`（`send_message`/`interrupt_agent`/`list_agents`）、`dsh-tool-subagent-report`（子级 `report`） |

提供方从"新建一个子 agent"（in-process）到"把一个轮次委派给另一个产品"（codex/claude-code/acp）千差万别——同一个接口，多个世界。

## 两类能力，两种发现方式

提供方通过静态描述符公布其**启动时**功能：

```ts
/** Which START-TIME features a provider supports. */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

请求依赖提供方不具备的能力时被**明确拒绝**（`SubagentError('UNSUPPORTED_CAPABILITY')`）——绝不会接受后静默忽略。**可继续**子 agent 由继续执行管理器自行组合，以方法存在与否作为能力（`prepareContinuable`）。

## 单次启动请求

```ts
/** What a caller asks for when starting a ONE-SHOT subagent. */
interface SubagentStartRequest {
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /** The spawning agent. */
  readonly parent: Agent
  /** Cancellation signal from the spawning context (the tool's exec.signal). */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  readonly outputSchema?: ObjectJsonSchema   // 需要 capability
  readonly maxDepth?: number                  // 需要 depthLimit
  readonly toolFilter?: ToolRestriction       // 需要 toolFilter
  readonly persona?: string                   // 需要 persona
}
```

* **`toolFilter`**：进程内后端在子 agent 创建窗口应用 `tools.restrict()`——被过滤的工具从子级的提示词消失**并且拒绝执行**（"可见性而非权限"），带 loud 的未知名称校验
* **`persona`**：注册为子级的 `deployment:persona` section，遮蔽部署 persona（严格 `{{…}}` 插值）
* **`maxDepth`**：绝对委派深度上限（非负安全整数）
* **`outputSchema`**：对象根 JSON Schema（`assertObjectJsonSchema` 子集）；成功的子级返回匹配的 `structured` 值

## 可继续子 agent 与 Activation

**可继续后台 subagent** 是一份持久化子 agent 会话，至多关联一个进程内的 **Activation**（被重建的子 agent 处于驻留状态的时段）：

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

* Activation 可以执行多个 FIFO 轮次，并在其创建的后代仍在运行期间保持驻留
* Agent inbox 是**唯一的队列**：每条继续执行消息都会成为一个 `Agent.followup()` FIFO 轮次，接受的消息共享同一个可观测顺序
* `followup()` 的路由仅取决于 Activation 驻留状态：`running` → 入队；`waiting` → 唤醒；无 Activation → **冷恢复**一个新的 Activation

后续操作的权限来自确切的在线 Agent 工具上下文：已认证的 Agent 必须是持久化子 agent 在 `SessionHeader.parentSession` 中记录的**直接父级**。

## 控制工具

| 工具 | 行为 |
|---|---|
| `subagent` | 按提供方委派（默认 `continuable`，省略参数时后台运行，runtime 自动投递结果） |
| `subagent_fork` | 绑定 fork 后端（`one-shot`，省略参数时前台运行） |
| `send_message` | 向可继续子 agent 投递后续消息（FIFO 轮次） |
| `interrupt_agent` | 对在线目标 `Agent.cancel(cause, { keepInbox: true })`——中断后一次唤醒发送恢复被暂停的 FIFO 队列 |
| `list_agents` | 只读列出活跃子 agent 与后代（基于会话存储与实时注册表） |
| `report` | 按可继续进程内子级注册的返回通道：向直接父会话写入 user-role 消息 |

`interrupt_agent` 的鉴权：`{ kind: 'user', parentSessionId }`（人类客户端呈现持久化直接父地址）或 `{ kind: 'ancestor', agent }`（在线祖先链包含调用方）。错误的 parent 地址以 `UNAUTHORIZED` 拒绝。

## 委派深度与预算

`delegationDepth` 是持久的会话元数据——子 agent 递归预算跨重启保留。请求的 `maxDepth` 限制子级的计算深度：超过预算的委派在启动时拒绝，防止失控的递归委派环。

## 与工作流的边界

[工作流](../tools/workflow.md)（`workflow` 工具）是"由模型编写、启动 subagent 的编排脚本"——脚本通过 `agent()` 启动子 agent，每个子 agent 归属于运行发起的那个 Agent。subagent 是单次/可继续的委派原语，workflow 是脚本化的批量编排。Ralph 循环则是"面向不可变目标的前台全新 agent 工作流"（见[工作流](../tools/workflow.md)）。
