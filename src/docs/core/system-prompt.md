# System Prompt 动态组装

> 深入解析 DeepSeek Harness 的 System Prompt 组装机制（`packages/core/system-prompt`）：提示词段落按 order 拼接、动态上下文按需物化、工具 schema 白名单投影——如何把零散插件贡献组装成缓存友好的请求前缀。

## 一个核心设计：注册表，而非模板

System Prompt 不是一份写死的模板，而是一个**注册表**：任何插件都可以注册提示词段落（`PromptSection`）与动态上下文（`PromptContext`），组装时按 `order` 排序拼接。这使"加一段提示词"变成一次注册调用，而不是修改模板文件。

```text
插件 A 注册 section("harness:identity", order=-100)
插件 B 注册 section("deployment:persona", order=0)
插件 C 注册 section("tool:guidance", order=150)
插件 D 注册 context("workspace:notice", order=10)
         │
         ▼ 组装（per step）
   sections 按 order 升序拼接
   + ctx.tools.schemas(scope) 工具 schema 允许列表
         │
         ▼
   request/header 事件写入日志（EpochHeader.system + .tools）
```

## `PromptSection`：提示词段落

```ts
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Unique name — a duplicate registration throws. */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Convention: `-100` is the
   * harness identity, `0` the deployment persona, tool guidance uses 100–199;
   * other negative orders also render before the persona.
   */
  readonly order: number
  /** Static text or a provider evaluated at each assembly with that assembly's context. */
  readonly text: string | ((context: AssembleContext) => string)
  /** Treat this contribution as the complete system prompt. */
  readonly complete?: boolean
}
```

关键语义：

* **`order` 约定**：`-100` 是 harness 身份，`0` 是部署 persona，工具指引用 100–199；负序也渲染在 persona 之前。协作式组装完成后，一个有效的 `complete` 段会成为唯一的提示词段落
* **`text` 可以是函数**：每次组装以当次的 `AssembleContext` 求值，文本可引用 `{{variable}}`，稍后由 `renderPrompt` 插值
* **重复注册抛异常**：同名段在一次组装中只能有一个

## `PromptContext`：动态上下文

`PromptContext` 是与段落对应的缓存安全结构——动态模型上下文被物化为**持久的 user-role 快照**：

* agent loop 仅在完整当前快照发生变化或被压缩移除时，才会将其记录在保留的模型历史之后
* 文本可为函数；空文本贡献为空
* 每个上下文条目有自己的 `source` 与元数据（如 `{ kind: 'plugin', plugin: '…' }` + `form`）

消息来源的 `form` 词汇是语义的，从不视觉化：`instructions`（工作区文件的指令）、`catalog`（可用项目录）、`snapshot`（当前状态，后快照取代前快照）、`notice`（刚发生的事，一次性）、`relay`（另一 agent 发来的消息）、`recall`（从另一会话日志取出的材料）。

## 工具 schema：白名单投影

`ctx.tools.schemas(scope)` 把当前作用域可见的工具定义投影为**面向模型的 `ToolSchema[]`**：只含 `name`、`description`、`parameters`——`output`、`execute`、`finalizeContent`、`timeoutMs`、`isConcurrencySafe`、`presentCall`、`presentResult` 等执行与展示回调**绝不泄漏到模型请求中**。

作用域解析使每个 agent 看到不同的工具清单：全局层 + 该 agent scope 链上的每个祖先，带作用域的工具遮蔽同名的全局对应项，restriction 过滤全局工具集合（见[Agent 作用域](../core/scope.md)）。

## 组装上下文

```ts
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /** Scope whose providers and waterfall listeners participate. */
  scope?: ScopeKey
  /** Explicit control signal for the turn that requested this assembly, when any. */
  signal?: AbortSignal
}
```

`AssembleContext` 标识一次组装所解析的作用域层。`dsh-agent` 添加可选字段 `agent`；`assembleContextFor(agent, signal)` 一起设置显式字段。裸组装既没有作用域也没有信号。

## 缓存友好

系统提示词是请求中最昂贵、最重复的部分。两个机制保证缓存友好：

1. **增量记录**：`request/header` 只在请求变化时记录新快照；动态上下文只在快照变化或压缩移除时追加——不会每步重写
2. **纯函数重建**：请求头是日志的纯函数，回放/恢复/压缩后从最新快照重建，不需要实时镜像

## 实践：注册一段提示词

```ts
import { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.systemPrompt.section({
    name: 'my-plugin:guidance',
    order: 120,                       // 工具指引区间
    text: 'When the user asks about X, prefer approach Y.',
  })
  // disposer 由 effect 自动管理：插件卸载时该段被撤销
}
```

这就是"一切皆插件"的日常形态——不加提示词到模板，而是注册一个段落，reload 即生效，卸载即撤销。
