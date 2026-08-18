# 人类命令：斜杠平面

> 以斜杠开头的指令，由面向人类的适配器通过 `ctx.commands` 解释并执行——**不会成为模型消息**。它既不同于面向模型的工具，也不同于通过 `ctx.shell` 执行 shell 命令。

## 命令平面

人类命令（`/plan`、`/goal`、`/compact`……）是 UI 适配器与命令插件负责的**发现、解析、分发、取消与结果渲染**机制：

```text
用户输入: /plan
  → 适配器解析 → parseCommand() → ParsedCommand
  → 作用域解析 → CommandDescriptor（无 handler 的只读视图）
  → command/run 事件（记录 rawInput）
  → 对确切 agent 执行 handler
  → CommandResult 直接呈现给 UI（不是工具结果，不是会话事件）
  → command/done 事件
```

除非处理器另行改变持久领域，**命令输出属于 UI 状态**——命令不需要模型轮次，也不需要 `tool/call`/`tool/result` 事件。

## 定义

```ts
/** Plugin-owned command registration. */
interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /** Whether command/run records rawInput. Defaults to true. */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

## 调用与结果

```ts
/** Invocation passed to one registered command handler. */
interface CommandInvocation {
  readonly commandId: CommandId     // 与 command/run 事件配对
  readonly agent: Agent             // 确切目标 agent
  readonly rawInput: string         // 名称之后的精确文本（含分隔符）
  readonly signal: AbortSignal      // UI 请求拥有的取消信号
}

type CommandResult =
  | { kind: 'success'; text?: string; sourceEventSeq?: number }
  | { kind: 'error'; text: string }
```

`sourceEventSeq` 是可选字段，只用于成功结果：指向接收会话日志中更早的一条非命令事件——`command/done` 持久化同一引用，让客户端能够将命令生命周期与该领域投影合并。

## 随发行版提供的命令

| 命令 | 提供方 | 行为 |
|---|---|---|
| `/plan [off|message]` | `dsh-plan-mode` | 切换计划模式；非空消息先选计划模式再 `agent.steer()` 提交（见[计划模式](../safety/plan-mode.md)） |
| `/goal` | `dsh-command-goal` | 观察或更改当前目标（见[同会话目标](../agent/goal.md)） |
| `/compact` | `dsh-command-compact` | 手动压缩（见[上下文压缩](../context/compaction.md)） |
| `/list-agents` | 独立插件 | 列出活跃 agent（经 sessionProjections 与实时注册表） |

## 与工具和 shell 的边界

| 维度 | 人类命令 | 模型工具 | shell 命令 |
|---|---|---|---|
| 触发者 | 人类 | 模型 | 模型（经 bash 工具）或插件 |
| 是否产生模型消息 | 否 | 是（tool/call 事件） | 是 |
| 是否需要模型轮次 | 否 | 是 | 是 |
| 结果去向 | UI 状态 | 会话日志 + UI | 会话日志 + UI |
| 示例 | `/plan` | `bash`、`read` | `pnpm run test` |

## 注册一个命令

```ts
import { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.commands.register({
    name: 'mystat',
    description: 'Print workspace statistics.',
    handler: async ({ agent }) => {
      const n = agent.session.events.length
      return { kind: 'success', text: `Session has ${n} events.` }
    },
  })
}
```

命令的可用性由插件组合决定：每个消费注册表的适配器都会看到全部生效定义。
