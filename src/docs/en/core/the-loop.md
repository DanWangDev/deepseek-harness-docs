# The Agentic Loop: The Core Mechanism of the Autonomous Loop

> An in-depth analysis of the DeepSeek Harness agent loop driver (`packages/core/agent-loop`) — the complete state machine from inbox claiming, prompt assembly, streaming model calls, and tool execution to termination decisions, based on the event catalog and type declarations at the source level.

## What Is the Agentic Loop

A traditional chatbot: you ask, it answers. DeepSeek Harness is different: you state a requirement, and it may execute multiple consecutive operations before giving you the final result.

The mechanism behind this is called the **Agentic Loop**. dsh's loop is not a `while(true)` — it is modeled as **event-driven turn draining**:

* **step**: one model request, plus the tool executions triggered by the model's response
* **turn**: one draining pass over admitted input in a session, containing zero or more steps; it ends when the model and its tools stop working or a termination policy intervenes

A turn opens before claiming the first input and closes when no work is owed anymore. **The turn and step boundaries are persistent session events** (`turn/start`, `step/start`…), not live emits — so after a crash the loop's complete trajectory can be rebuilt from the log.

## The Complete Structure of the Loop

The driver (`ctx.agentLoop`) runs inside `ctx.agents.withInitiator()`; a typical turn contains the following stages:

```text
① inbox claim
   claim(target): take all next-step inputs + one next-turn message at the turn boundary
   → agent/pre-step (waterfall): reject or enter(messages)

② prompt assembly
   ctx.systemPrompt concatenates prompt sections (PromptSection)
   + ctx.tools.schemas(scope) tool schema allowlist
   → request/header event: full request envelope written to the log

③ history derivation
   deriveMessages() projects model history from the session log (the surface is the only source)

④ streaming model call
   agent/request (waterfall; can replace the frozen call config)
   → llm/stream → assistant/chunk* (raw chunks) → assistant/message (assembled message)

⑤ tool execution
   tool/call* → tools/pre-execute (allow/deny/ask)
   → ToolGuard (monotonic guard) → tools/execute (around dispatch)
   → tools/post-execute (inspect/replace result) → tool/result*

⑥ continue or terminate
   Tools still owe another request? next-step input arrived? → claim → next step
   Otherwise → agent/turn-stopping (serial) → turn/end
```

## Stage Details

### Stage 1: Inbox Claiming and the pre-step Decision

Input reaches the driver through a single inbox. Some messages wake it immediately; injected context stays in the inbox until another message wakes it. The inbox is **two ordered pending-message lists** (a persistent projection):

```ts
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

`claim(target)` removes the batch proposed for the step via a pure-deletion splice — **all `next-step` inputs, plus one `next-turn` message at the turn boundary** — and emits an `agent/inbox/claimed` notice for each item.

`agent/pre-step` is the only serial listener chain before request derivation; it decides what the model sees:

```ts
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

Listeners may rewrite the claimed messages or reject them outright; when the first claim is rejected or rewritten to empty, a persistent turn with no step still closes — the log records the attempt. Step admission also accepts **tool continuations**: between steps, tools may submit an empty claimed batch, letting the loop continue without introducing new input.

### Stage 2: Prompt Assembly and the Request Header

Each step reads the plugin-registered prompt sections (`PromptSection`, concatenated in ascending `order`) and the tool schemas (the allowlist projection of `ctx.tools.schemas()`). The assembled result is written to the log together with the call config as a **`request/header` event** — `EpochHeader` holds the call config, adapter defaults, the rendered system prompt, and the assembled tool schemas. **Every conversation request is a pure function of the log**.

### Stage 3: History Derivation

Model history is **never stored separately** — `Session.deriveMessages()` derives it by projecting the session log's surface. `user/message` carries the exact content; `assistant/message` is the authoritative assembled message (raw `assistant/chunk` is skipped during derivation and used only for replay/UI fidelity); `tool/result` projects to a user message carrying a `tool-result` block.

### Stage 4: Streaming Model Calls

`agent/request` is a waterfall: `await next()` yields the call config the machine will use (agent options for the first request, the logged header afterwards); return a replacement to switch. **Model-visible content must use the logged channel — this waterfall cannot rewrite messages**.

`llm/stream` returns the raw `StreamChunk` protocol (a closed discriminated union whose `switch` ends in `assertNever`): `block-start`, `text-delta`, `reasoning-delta`, `tool-call-delta`, `block-end` (carrying the fully assembled `ContentBlock`), `usage`, `finish`. Exceptions thrown by adapters are normalized into a terminal `error` or `aborted` finish.

### Stage 5: Tool Execution

A tool call starts with the `tool/call` event (`callId` pairs the call with its result; `arguments` is the raw JSON string produced by the model) and passes through the full pipeline:

```text
tools/pre-execute (waterfall)   → allow | deny | ask (the approval service decides)
ToolGuard (monotonic)           → returning a reason rejects; cannot be undone
tools/execute (waterfall)       → around dispatch: timeout, retry, metrics
tools/post-execute (waterfall)  → accept | replace | block
finalizeContent (tool-owned)    → last-mile content transform
tools/result (emit)             → frozen final result; observers cannot transform it
```

Execution scheduling has two modes: `parallel` (may overlap with sibling calls; the tool must declare `isConcurrencySafe`) and `exclusive` (runs alone, forming an ordering barrier).

## Termination Conditions

A turn ends with a `TurnEndReason` (a merge-extensible sum type):

| Reason | Meaning |
|---|---|
| `completed` | Normal completion: tools no longer owe requests, no new input |
| `aborted` | A cancellation request interrupted the active turn (`{ kind: 'user' | 'parent' | 'hook' | 'disposed' }`) |
| `blocked` | Blocked |
| `error` | The turn failed; `error` is a structured failure (`LlmError` fact verbatim, or a flattened `UNKNOWN`) |
| `max-tokens` | At least one step hit the output token limit — even if execution continues afterwards, the truncation fact still takes precedence |
| `interrupted` | The persistence backend closes crash-leftover turns at reload (the only reason not emitted by the loop) |

## Cancellation and Error Recovery

`Agent.cancel(cause, options)` is the only cancellation entry point: it clears queued and steering work (unless `keepInbox`) and aborts the active turn. cause is a TypeScript-enforced same-process input; the persistent `turn/end` keeps only the coarse-grained `{ kind: 'aborted' }`.

`agent/request-error` runs after the failed model step closes and before the turn closes: a listener that returns `{ kind: 'retry' }` without calling `next()` owns the recovery; the default `undefined` keeps the failure terminal.

## Why Turn Boundaries Are Persistent

Turn and step boundaries are **persistent session events** rather than agent emits, which gives the whole system three properties:

* **Crash-recoverable**: `interrupted` is synthesized by the persistence backend at reload, and events remain intact before the crash
* **Replay is reproduction**: any UI can rebuild the complete trajectory from the log, with no live mirror
* **Model-visible means logged**: every fact the loop carries is persisted as an event, mechanically verifiable by a runtime invariant

## Next Stop

The conversational vocabulary the loop carries (`Message`, `ContentBlock`, `StreamChunk`) is declared by `packages/llm`; the log the loop writes is defined by the [Session Log](../core/session.md) — that is the next stop for understanding where memory comes from.
