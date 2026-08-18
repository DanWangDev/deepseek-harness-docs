# Cordis：一切皆插件的基座

> Cordis 是 DeepSeek Harness 底层以 vendor 方式引入的插件框架：插件向共享上下文贡献服务、类型化事件和可逆的副作用。理解 Cordis 的五个核心概念，就理解了 dsh 的一切。

## 五个核心概念

- **插件是实现 Service 的对象。** 它可以是一个带有可选 `inject` 和 `apply(ctx)` 字段的函数，也可以是一个 `Service` 子类，其生命周期由 Cordis 挂载到当前上下文中。
- **上下文是服务的容器。** 一个服务占据一个稳定的 `ctx.<key>`（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`）；其他插件通过 key 查找服务，而非导入具体实现。
- **通过 `inject` 声明服务依赖。** 插件声明所需的服务后，会等待这些服务就绪才启动；加载顺序通过服务依赖表达，而非手动编排启动序列。
- **类型化事件用于通信。** 服务通过 TypeScript 声明合并注册事件名，然后以 `emit`、`waterfall`、`parallel` 或 `serial` 方式分发。
- **注册是可逆的副作用。** 提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时会按预期撤销。

## 分发模式

每个事件具有以下分发模式之一，且只能通过对应方法分发：

| 模式 | 是否 await？ | 分发顺序 | 是否有返回值？ |
|---|---|---|---|
| `emit` | 否 | 监听器按注册顺序观察 | 否 |
| `waterfall` | 否 | 监听器按注册顺序观察 | 是 |
| `parallel` | 是 | 所有监听器并行观察事件 | 否 |
| `serial` | 是 | 监听器按注册顺序观察 | 是 |

分发模式是事件公开约定的一部分。新的 harness 事件通过 `@mode` 标签记录模式，以便生成的目录可以将声明与分发调用点做交叉校验。

## Waterfall 语义：环绕中间件

`ctx.waterfall` 是**环绕中间件**。监听器接收 `(...args, next)`。调用 `next()` 会执行下游监听器；下游返回值通过 `next()` 返回当前包装层，可由该层包装后继续向外返回。**不调用 `next()` 直接返回则短路**：

```text
最外层监听器 (waterfall listener A)
  └─ next() ──► 下游监听器 B
                 └─ next() ──► 默认行为（调用方）
                 ◄─ 返回值 ───┘
  ◄─ 包装后返回 ──┘
```

协作式监听器通常修改一个共享的请求或决策对象，然后委托。监听器也可以选择完全替换结果——下游监听器将只看到替换后的结果。仅当监听器必须在普通注册之前运行时才使用 `prepend: true`。

对于单决策事件，短路是**设计意图**：策略监听器在拥有决策权时可以不调用 `next()` 直接返回（如 `agent/pre-step` 的 reject、`tools/pre-execute` 的 deny），而仅做标注或观察的监听器则必须委托。

## 类型化事件：声明合并

dsh 中几乎所有可扩展的和类型都遵循同一模式：一个以判别标签为键的接口（`…Map`），联合类型由 `keyof` 派生。**插件通过声明合并添加变体——无需修改拥有该类型的包**：

```ts
// 模式示意
interface ThingMap {
  'a': { kind: 'a' }
  'b': { kind: 'b' }
}
type ThingKind = keyof ThingMap        // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]  // 可辨识联合

// 插件扩展它，而不触碰源码包
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'my-plugin/event': MyPayload
  }
}
```

六个规范 map 使用此模式：`ContentBlockMap`、`MessageSourceMap`、`FinishReasonMap`（dsh-llm），`TurnTriggerMap`、`TurnEndReasonMap`、`SessionEventMap`（dsh-session）。消费方最常 `switch` 的两个大型联合类型是 `StreamChunk`（流式协议）和 `SessionEvent`（日志条目）——对标签做 `switch`，每个分支都能窄化类型，拼错的标签会编译失败。

## Loader 配置：`!!js` 与 overlay

`@deepseek-ai/cordis-plugin-include` 将 `!!js` 解析为表达式节点。Loader 在声明的注入激活后，基于该插件上下文插值条目的 `config`，并在每次挂载决策时基于 loader 上下文插值其 `disabled` 字段；其余条目元数据保持字面值。**由环境选择插件时，请使用 overlay**（例如 `--profile headless` 与 `--patch` 的叠加），而不是在配置里写死条件逻辑。

## 实践规则

* 将行为封装为插件：工具流水线事件属于 `ctx.tools`，模型流式输出属于 `ctx.llm`，实时 agent 协调属于 `ctx.agents`
* 拦截和策略优先使用事件；直接能力调用优先使用服务方法
* 每个注册都应有对应的 disposer：要么从 `ctx.effect()` 返回一个，要么使用 Cordis 提供的辅助方法自动处理
* 如果 teardown 顺序有要求，请将相关工作放在同一个 effect 中，以确保资源按预期顺序释放

## 从框架到产品

Cordis 提供了"插件 + 上下文 + 事件"的通用骨架；DeepSeek Harness 在这之上定义了产品词汇：`SessionEventMap`（会话事实）、`ctx.tools`（工具注册表）、`agent/*` 事件（活跃 agent）、能力 seam（Service Definition / Provider / Consumer 三件套）。后续章节逐一展开这些词汇——下一站是驱动这一切的[Agentic Loop](../core/the-loop.md)。
