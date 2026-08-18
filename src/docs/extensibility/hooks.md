# Hooks：Claude Code/Codex 桥接

> 从源码角度解析 DeepSeek Harness 的 Hooks 桥接：如何把 Claude Code 与 Codex 的 `hooks.json` 事件桥接到 harness 的类型化拦截点——`dsh-hook-protocol` 共享协议库 + `dsh-hooks-claude-code` / `dsh-hooks-codex` 两个桥插件。

## 设计哲学：规范扩展面是 harness 的拦截点

"native hook" 在 DeepSeek Harness 里就是一个**普通插件**——`agent/pre-step`、`tools/pre-execute` 等类型化拦截点就是规范扩展面。Hooks 桥仅为**外部 `hooks.json` 兼容路径**：让你已有的 Claude Code/Codex hooks 配置在 dsh 上继续工作。

| 包 | 角色 |
|---|---|
| `dsh-hook-protocol` | 共享 wire-protocol **库**（非插件，不注册不注入）：matcher、`runHook`、输出解析与合并 |
| `dsh-hooks-claude-code` | Claude Code hooks 桥（Cordis 插件） |
| `dsh-hooks-codex` | Codex hooks 桥（Cordis 插件） |

## 协议库原语

```text
matchesMatcher(matcher, subject)   — claude 模式：literal-or-regex；codex：恒 regex
runHook(bash, hook, opts, now)     — stdin payload + env 经 ctx.shell；timeoutSec 或默认 10 分钟
parseHookOutput(output)            — exit 2 阻塞；其他非阻塞
mergeHookOutputs(...)              — 权限 deny > ask > allow；halt 粘滞；additionalContext 累积
```

`runHook` 从不 throw——executor 拒绝时返回 `HookOutput` exitCode `undefined`。合并规则：权限**deny > ask > allow**，halt 粘滞，block 原因用 `\n\n` 连接，`additionalContext`/`systemMessages` 按顺序累积。

## 会话事件：hook/invoked 与 hook/result

桥接层为每次 hook 调用记录一对**仅日志**的会话事件：

* `hook/invoked` + `hook/result` 按 `handlerId` 配对
* `stderrSummary` 截断到 `stderrSummaryMaxChars`（默认 500）
* 非 `SurfaceEventType`——不进入模型 transcript，但持久可审计
* 记录必须发生在已打开的轮次内（`SessionStart` 不生成 hook 记录，它在轮次 1 之前运行）

## Claude Code 桥的事件映射

| CC hook 事件 | harness 拦截点 | 行为 |
|---|---|---|
| `SessionStart` | `agent/session-start`（emit） | 注入 `agent.inject()` 上下文 |
| `UserPromptSubmit` | `agent/pre-step`（waterfall） | deny → `PreStepDecision.reject` |
| `PreToolUse` | `tools/pre-execute`（waterfall） | deny/ask → `PreToolDecision.deny/ask` |
| `PostToolUse` | `tools/post-execute`（waterfall） | 检查/替换结果 |
| `Stop` | `agent/turn-stopping`（serial） | 经 `steer()` 强制下一步 |
| `SubagentStart` / `SubagentStop` | `subagent/start` / `subagent/end`（emit） | 注入 / 只观察 |

matcher subject：工具名、会话 source、常量 `agent_type` = `general-purpose`。同一拦截点多个 hooks 串行执行，most-restrictive 折叠。stdin 携带 `session_id` + `transcript_path`（经 `ctx.sessionPersistence.locate(session.header)`）。

## Codex 桥

Codex 桥覆盖 5/10 个 hook 点（`PreToolUse`/`PostToolUse`/`SessionStart`/`UserPromptSubmit`/`Stop`），差异：

* **regex-only** matcher（无 literal 模式）
* snake_case payload + `turn_id`/`model`，**无尾换行**
* 无 plugin env、无 pre-tool 批准/重写
* `block`（exit 2）→ `PreStepDecision.reject` / `PreToolDecision.deny`
* `transcript_path` 缺省发 `null`

## 配置

```yaml
# claude-code 桥（示意）
hooks-claude-code:
  config:
    configPath: .claude/settings.json   # 现有 hooks.json 位置
    pluginRoot: .claude/plugins
    projectDir: .
    defaultTimeoutMs: 600000
    stderrSummaryMaxChars: 500
```

两桥的 `configPath` 是进程级（per-session hook config 是未实现的 TODO）。

## 阻塞文本与注入来源

注入上下文带显式来源 `{ kind: 'plugin', plugin: 'hooks-claude-code' | 'hooks-codex' }`；阻塞文本精确如 `blocked by PreToolUse hook`——模型可以明确区分"被 hook 拦下"与"工具失败"。

## 与权限模型的协同

hooks 的 PreToolUse 桥接插入 `tools/pre-execute` waterfall——它在审批服务**之前或之后**取决于注册顺序，但最终都要经过单调的 `ToolGuard`（见[审批模型](../safety/permission-model.md)）：hook 可以 deny，无法把另一个组件 deny 的调用翻回 allow。
