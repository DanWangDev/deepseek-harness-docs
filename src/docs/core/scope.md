# Agent 作用域：可见性即生命周期

> 一个贡献（工具、提示词段、变量、限制、监听器）要么是*全局的*，要么归属于恰好一个 scope key。带作用域的注册既决定可见性，也绑定生命周期——同一事实决定两者。

## 为什么需要作用域

一个 harness 进程里通常有多个 agent：主 agent、委派出的子 agent、后台可继续 agent。它们共享同一个 `ctx` 世界，但**不应该看到同样的东西**：

* 子 agent 不该看到父 agent 的私有工具
* 一个 agent 的 persona 不该污染另一个
* 一个 agent 的生命周期结束，它的注册必须随之撤销

DeepSeek Harness 用两层扁平结构解决这个问题：`scope/` 库提供身份、载体与作用域层词汇，使同一注册上下文同时表达每个 agent 的可见性和共享生命周期所有权。

## 核心原语

```ts
/** An opaque, identity-compared scope key. */
type ScopeKey = object
```

`ScopeKey` 是不透明的对象身份标识——已交付的 agent loop 使用活跃的 `Agent` 对象作为自身的 key，但该原语从不检视该对象。

**只有两层，采用扁平结构**：带作用域的注册不会向下继承给 subagent；子树行为通过 lineage（`parentSession`、`delegationDepth`、`subagentDepth`）数据表达，从不通过 scope 结构。

```ts
/** A minted registration scope and its quiescent disposal boundaries. */
interface Scope {
  /** Context through which scope-owned registrations are made. */
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  dispose(): Promise<void>
}
```

## Scoped Dispatch：事件按 subject 路由

`Scoped<T>` 是编译期品牌标记，标注在 `scopeTarget(base, key)` 返回的不透明路由接收器上：

```ts
/** A routing-only event receiver built by scopeTarget. */
type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }
```

作用域过滤的事件声明以此载体作为 `this` 类型，真正的事件主体仍作为显式参数传入。**分发规则**：

* 关于某个 agent 的活动的事件，以该 agent 的 carrier 分发——agent-scoped 监听器只收到那个 agent 的事件
* 关于注册表本身的事件（如"一个工具被添加了"）属于注册表主体事件，保持不过滤

例如 `agent/pre-step` 的声明是 `'agent/pre-step'(this: Scoped<Agent>, payload: {...}, next)`——只有该 agent 作用域内的监听器参与它的 pre-step 决策。

## Shadowing：最具体者胜出

带作用域的工具、片段、变量仅在该 scope 内**替换同名的全局对应项**：

```text
全局工具 register("bash", …)
agent A scope: register("bash", …)   ← A 看到自己的 bash
agent B scope: （无注册）             ← B 看到全局 bash
```

这是按 agent 定制 persona 和工具变体的机制。工具注册表读取时将全局层与观察 scope 的链合并：最近层的条目直接赢得重名工具。

## Restriction 与 scope-local 注册

```ts
/** Per-scope filter over global tools. Restrictions intersect and do not affect scoped registrations. */
interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

`tools.restrict(filter)` 为单个 scope 过滤**全局**工具集合（多个 restriction 取交集组合）；scope-local 注册在过滤之后合并。被过滤掉的全局工具**既不出现在提示词中，也拒绝执行**——与不存在的工具无法区分（"可见性而非权限"）。仅 deny 的过滤器允许后续未列出的继承工具通过，而 allow 列表则排除它们——因此被委派的子 agent 会保留其回报所依赖的工具。

## Agent 上下文：`agent.ctx`

agent 的带作用域上下文。通过它进行的注册具有 scope 可见性，其生命周期也绑定到该 scope（同一事实决定两者）。`Agent` 句柄暴露：

```ts
/** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
readonly ctx: Context
```

## Setup Window：组装作用域世界

创建者组装 agent 作用域环境的创建时隙（`CreateAgentOptions.setup`）：

* 此时 scope 和 agent 对象已存在，但 agent 或会话尚未发布
* `agent/session-start` 尚未触发，首次提示词尚未组装
* **setup 只做注册，从不驱动 agent**——setup 拒绝、commit 抛出或所有者 dispose 都会回滚事务，两个 id 均不发布

子 agent 的创建窗口正是通过 `composeFrom(agentCtx, parentCtx)` 绑定父 preset 组合的地方（见[Agent Preset](../agent/preset.md)）。

## Lineage：数据，而非结构

父子关系以数据形式携带：`parentSession`（持久）、`delegationDepth`（持久的子 agent 递归预算）、`subagentDepth`（运行时）。**Lineage 从不影响可见性**——它服务于授权（如 subagent 后续操作要求持久化的直接父级）、预算与审计，而不是 scope 解析。

## 术语速查

| 术语 | 含义 |
|---|---|
| scope | 按 agent 划分的注册单位；只有全局与 scope-local 两层 |
| scope key | 不透明标识，按对象同一性比较；活跃 agent 就是其自身 scope 的 key |
| scope carrier | scope 过滤分发所携带的 `thisArg` |
| shadowing | 最具体者胜出的名称解析 |
| restriction | 为单个 scope 过滤全局工具集合 |
| setup window | 创建者组装 agent 作用域环境的创建时隙 |
| lineage | 以数据形式携带的父子关系事实 |
