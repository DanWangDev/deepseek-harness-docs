# Token 预算与请求头

> 从源码角度揭示 DeepSeek Harness 的 token 预算管理：请求信封如何作为会话状态落盘、路由容量如何记录、`ctx.tokenMeter` 如何从日志回放估算——上下文窗口的动态计算与自动压缩的触发依据。

## 请求信封：日志是纯函数

每次模型请求的完整信封作为会话状态写入日志——`request/header` 事件：

```text
request/header (reason: 'initial' | 'resume')   ← 每个 agent loop 实例的边界
request/header (reason: 'change')               ← 请求配置变化时的新完整快照
request/context                                 ← 路由或容量变化时记录
```

```ts
/** Logged request state outside derived history: call config, system prompt, and tools. */
interface EpochHeader {
  config: LlmCallConfig
  adapterDefaults?: LlmCallConfigAdapterDefaults
  system?: string
  tools?: ToolSchema[]
}
```

`foldRequestHeader(events)` 通过选择最新快照重建请求头——**每个对话请求都是日志的纯函数**。空系统提示词和空工具列表都表示为字段缺失，与请求构建方式一致。

## 路由容量：request/context

```ts
/** Registration-bound metadata for one resolved model route. */
interface RequestContext {
  provider: string
  model: string
  /** Maximum combined request and response context in tokens, when advertised. */
  contextWindow?: number
}
```

`request/context` 是独立的已记录状态，在同一步骤内紧随 `request/header` 追加，且**仅在提供方、模型或容量与上一条记录不同时追加**。容量描述的是路由，不是请求输入——把它折叠进 `EpochHeader` 会让一次容量变化被登记为请求信封的 `change`。适配器不公布容量的路由以缺失 `contextWindow` 记录。

## Token 记账

token 记账读取每个步骤的 `assistant/chunk { type: 'usage' }` 记录；如果没有用量分片，则将 `assistant/message.usage` 作为已提交步骤的后备。失败的模型请求尝试没有 assistant 消息，因此其用量分片是持久化的记账记录——**模型输出与其 token 记账一起旅行**，没有单独的 usage 记录。

## `ctx.tokenMeter`：可回放快照

`@deepseek-ai/dsh-token-meter`（`ctx.tokenMeter`，`packages/llm/token-meter`）提供独立的不可变回放快照：

```ts
/** Immutable replayable measurement snapshot. */
interface TokenMeasurement {
  logRevision: number        // 已消费持久事件数（= 下一未读 seq）
  baseline: { kind: 'usage' | 'estimated' }  // 锚点
  surfaceDeltaTokens: number // 自锚点起的 surface 增量
  totalTokens: number
  surfaceTokens: number
  nodes: TokenSurfaceNode[]  // { seq, tokens }
}
```

* `baseline.kind` 区分锚点是提供方上报的精确 usage 还是估算
* surface 顺序是权威的——替换节点 seq 可高于位置靠后者
* 快照不随回放折叠增长；token meter 是**单例**，压缩 seam 与计价消费方共用它

## 预算决策链

```text
请求发出 → usage 分片落盘（assistant/chunk）
  → token meter 从日志回放估算当前占用
  → 压力压缩（compactIfNeeded）评估：
      pressure（压力策略）或 context-overflow（规范化溢出）
  → 超出阈值 → compaction 折叠旧 surface 为摘要
  → 请求头重建 → 下一轮请求
```

`dsh-compaction-basic` 拥有阈值、保留尾部策略、溢出上限与失败处理；token meter 只负责"现在用了多少"。压缩的详细机制见[上下文压缩](../context/compaction.md)。

## max-tokens 语义

提供 `maxTokens` 时，它必须是正安全整数，限制每次对话模型请求的输出；省略时，系统在写入请求 header 前填入确切模型的适配器默认值。只要轮次内任何步骤以 `max-tokens` 结束，整个轮次就以 `max-tokens` 结束——截断事实优先于 `completed`（见[会话日志](../core/session.md)的 `TurnEndReason`）。
