# The Session Log: The Single Source of Truth for Event Sourcing

> A `Session` is an **append-only log** of typed `SessionEvent`s and the single source of truth for an agent's complete interaction history. The LLM message history is *derived* from the log, never stored separately — replay simply re-derives from the same set of events.

## The Event-Sourcing Model

A DeepSeek Harness session is not an "array of messages" but an **event log**:

* Every entry carries a monotonic `seq` (`seq = log.length`), a `time` (epoch milliseconds), and a `data` payload discriminated by `type`
* Events are **lossless JSON** — `Session.append` enforces this at the source, and malformed events never enter the log
* The log only grows, never changes: model history, UI replay, fork, resume, transcript, and telemetry all derive from the same event stream

The persistence backend (JSONL / SQLite) saves every event losslessly, **including** the raw `assistant/chunk` chunks — `seq` must be contiguous, so chunks cannot be filtered out of the canonical log.

## `SessionEventMap`: The Event Vocabulary

The core session events (extensible via declaration merging — plugins add extra event types through `declare module`):

| Event | Payload | Purpose |
|---|---|---|
| `turn/start` | `{ turn }` | Opens a turn; rejection, empty input, cancellation, or failure may close it with no step |
| `turn/end` | `{ turn, reason }` | Closes a turn with a `TurnEndReason` |
| `step/start` / `step/end` | `{ turn, step }` | Opens/closes a step (one model call plus the tool executions it requested) |
| `user/message` | `UserMessage` | A user-role message: a direct prompt, context injected via `agent.inject()`, a goal continuation turn |
| `assistant/chunk` | `{ turn, step, chunk }` | Raw streaming chunks — token-level replay fidelity |
| `assistant/message` | `{ turn, step, message, usage? }` | The assembled assistant message (used by derived history); carries the step's token accounting |
| `tool/call` | `{ turn, step, callId, name, arguments }` | The model requests a tool call; `arguments` is the raw JSON string produced by the model (unparsed) |
| `tool/result` | `{ turn, step, message, error?, meta? }` | The model-visible result of a completed tool call + optional internal failure identity + tool-private `meta` |
| `todo/write` | `{ todos }` | Full-list snapshot; latest-write-wins |
| `request/header` | `{ header, reason }` | The complete envelope for the next request (call config + system prompt + tool schemas) |
| `request/context` | `RequestContext` | Context metadata of the route the request resolved to (logged only on route or capacity change) |
| `session/end-seed` | `{}` | Marks the end of the construction seed; earlier seqs come from the seed (resume/fork/replay) |

The three message-producing **surface events** (`user/message`, `assistant/message`, `tool/result`) carry `surfaceOp` and `sourceEventSeqs` — they declare how they join the ordered derived surface:

```ts
/** How a session event entered the ordered surface. */
type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }
```

`append` is the ordinary tail append; `replace` shadows the surface entries from `start` to `end` (inclusive) and inserts the new event in place — this is the only way compaction performs surface changes.

## Derived History: What the Model Sees

`Session.deriveMessages()` projects the event log into the `Message[]` the model sees. Projection rules:

| Event | Projection |
|---|---|
| `user/message` | A user message carrying the exact `content` |
| `assistant/message` | An assistant message including the provider and model that produced it; **messages with empty content are skipped** (a step truncated by max-tokens with no content still records the event to preserve usage) |
| `tool/result` | A user message carrying a `tool-result` block |
| Other events (`turn/*`, `step/*`, chunks) | Structural information, not projected as messages |

The projection is **cached and frozen**: each surface node is projected once on first appearance, and a surface rewrite triggers a rebuild; the returned `Message` objects are shared and deeply frozen, so modifying recorded history through the projection is not expressible at the type level.

## Request Header: The Log Is a Pure Function

The request envelope (`EpochHeader`) is written to the log as session state:

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

A full snapshot with reason `'initial'` or `'resume'` records the boundary of each agent loop instance; afterwards, when the request changes, another full snapshot is recorded with reason `'change'`. **Every conversation request is a pure function of the log** — `foldRequestHeader(events)` rebuilds the request header by selecting the latest snapshot.

## Turn End Reasons

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

`max-tokens` corresponds to the `FinishReason` of the same name in model calls: if any step within a turn ends with `max-tokens`, the whole turn ends with `max-tokens` — the truncation fact takes precedence over `completed`. `interrupted` is the only reason no loop ever emits: it is synthesized by crash recovery.

## Fork: Deriving a Session

`ctx.sessions.fork(source, boundary?, childSessionId?)` is the policy API for forking an active session:

* Selects the source events up to and including the `boundary` seq (defaults to the current last event)
* **Requires the selected prefix to end with no open turn** — the API rejects a prefix ending inside an open turn rather than silently truncating
* Creates an active child session containing deep-cloned seed events and child-session metadata (`parentSession`, `seedLength`, and the inherited `cwd`)

A forked child session appends `session/end-seed` to mark its own seed boundary — the events before it have smaller seqs, come from the seed, and belong to a lifecycle that has ended.

## Execution Enclosure and Standalone Events

A turn encloses one model-loop execution, not the entire session log. Plugin-owned log-only events (such as `compaction/*`, `hook/invoked`) may appear between `turn/end` and the next `turn/start` — they consume event seqs but do not increment the turn number. Producers that need an immediate persistence barrier explicitly await `ctx.sessions.flush(session)`.

The optional `dsh-session/invariant` companion plugin enforces the core-owned relationships: turn and step numbering, execution-event enclosure, and tool call/result pairing within the same step.

## Model-Visible Means Logged

This is the **runtime invariant** of the session-log design: everything that reaches a model request must be reconstructable from the log. Therefore adding a model-visible input requires adding a session event — extend `SessionEventMap` and render from the log. If a new event is unrecognized and lacks the `ignorable: true` marker, readers **must refuse** to rebuild the session rather than silently drop it.
