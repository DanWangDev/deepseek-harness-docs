# Token Budget and Request Headers

> Reveals DeepSeek Harness token budget management from the source code: how the request envelope is persisted as session state, how route capacity is recorded, and how `ctx.tokenMeter` estimates by replaying the log—the basis for dynamic context-window computation and automatic compaction triggers.

## The Request Envelope: the Log Is a Pure Function

The full envelope of every model request is written to the log as session state—the `request/header` event:

```text
request/header (reason: 'initial' | 'resume')   ← boundary of each agent loop instance
request/header (reason: 'change')               ← new full snapshot when the request config changes
request/context                                 ← recorded when the route or capacity changes
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

`foldRequestHeader(events)` reconstructs the request header by selecting the latest snapshot—**every conversational request is a pure function of the log**. An empty system prompt and an empty tool list are both represented as missing fields, matching how requests are built.

## Route Capacity: request/context

```ts
/** Registration-bound metadata for one resolved model route. */
interface RequestContext {
  provider: string
  model: string
  /** Maximum combined request and response context in tokens, when advertised. */
  contextWindow?: number
}
```

`request/context` is separate logged state, appended right after `request/header` within the same step, and **only when the provider, model, or capacity differs from the previous record**. Capacity describes the route, not the request input—folding it into `EpochHeader` would register a capacity change as a `change` to the request envelope. Routes whose adapter does not advertise capacity are recorded with `contextWindow` absent.

## Token Accounting

Token accounting reads each step's `assistant/chunk { type: 'usage' }` records; when no usage chunk exists, `assistant/message.usage` serves as the fallback for a committed step. A failed model request attempt has no assistant message, so its usage chunk is the persisted accounting record—**model output travels together with its token accounting**; there is no separate usage record.

## `ctx.tokenMeter`: a Replayable Snapshot

`@deepseek-ai/dsh-token-meter` (`ctx.tokenMeter`, `packages/llm/token-meter`) provides a standalone immutable replayable snapshot:

```ts
/** Immutable replayable measurement snapshot. */
interface TokenMeasurement {
  logRevision: number        // consumed persistent events (= next unread seq)
  baseline: { kind: 'usage' | 'estimated' }  // anchor
  surfaceDeltaTokens: number // surface delta since the anchor
  totalTokens: number
  surfaceTokens: number
  nodes: TokenSurfaceNode[]  // { seq, tokens }
}
```

* `baseline.kind` distinguishes whether the anchor is the provider-reported exact usage or an estimate
* surface order is authoritative—a replacement node's seq can be higher than that of a later position
* snapshots do not grow with replay folding; the token meter is a **singleton** shared by the compaction seam and metering consumers

## The Budget Decision Chain

```text
Request sent → usage chunk persisted (assistant/chunk)
  → token meter replays the log to estimate current usage
  → pressure compaction (compactIfNeeded) evaluates:
      pressure (pressure policy) or context-overflow (normalized overflow)
  → threshold exceeded → compaction folds old surface into a summary
  → request header rebuilt → next-turn request
```

`dsh-compaction-basic` owns the thresholds, the retained-tail policy, the overflow cap, and failure handling; the token meter is only responsible for "how much is used now". For the detailed mechanics of compaction, see [Context Compaction](../context/compaction.md).

## max-tokens Semantics

When `maxTokens` is provided, it must be a positive safe integer limiting the output of each conversational model request; when omitted, the system fills in the exact model's adapter default before writing the request header. As soon as any step within a turn ends with `max-tokens`, the whole turn ends with `max-tokens`—the truncation fact takes precedence over `completed` (see `TurnEndReason` in [Session Log](../core/session.md)).
