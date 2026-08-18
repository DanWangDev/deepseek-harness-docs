# Runtime Invariants: The Architecture Proving Itself

> DeepSeek Harness's architectural promises land as mechanically checkable invariants: model-visible means logged, guards are monotonic, registration is a reversible side effect, scope decides visibility and lifecycle, branded ids prevent interchange — these are not style, they are gates.

## Invariant One: Model-Visible Means Logged

> Everything that reaches a model request must be reconstructable from the log.

```text
Model request
  ├─ system prompt ──► request/header (EpochHeader.system)
  ├─ tool schema ─► request/header (EpochHeader.tools)
  ├─ history messages ────► deriveMessages() ← surface events
  └─ injected context ──► user/message (agent.inject() channel)
```

Asserted by a **runtime invariant**: a new model-visible input requires a new session event (extend `SessionEventMap` and render from the log). The converse follows too — what the model **cannot see** (`output`, `execute`, `finalizeContent`, `timeoutMs`, `isConcurrencySafe`, `presentCall`/`presentResult`) never enters a model request: the `schemas()` allowlist projects only `name`/`description`/`parameters`.

## Invariant Two: Guards Are Monotonic

> No mechanism can flip a denied call back to allowed.

```ts
/** A monotonic execution guard evaluated after every tools/pre-execute listener and before the tool body. */
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

`ToolGuard`'s return type deliberately contains no allow result: `undefined` preserves the waterfall's decision, and a returned reason can only shrink permissions — so **listener order can never turn a deny into an allow**. Likewise, the `never` approval policy is enforced inside the service, before waterfall dispatch, and an answerer registered later with `prepend` cannot bypass it.

## Invariant Three: Registration Is a Reversible Side Effect

> Every registration has a matching disposer; it unwinds as expected on plugin unload.

* Prompt sections, tool schemas, adapters, providers, and listeners install through `ctx.effect()` / `ctx.on()`
* A registry's `register()` returns the exact disposer — composite effects yield it to nest teardown order
* The scoped world rolls back as a whole with the agent's unload: registrations on `agent.ctx` "unwind on disposal, reject registration afterward"

## Invariant Four: Scope Decides Visibility and Lifecycle

> A scoped registration both decides visibility and binds lifecycle — the same fact decides both.

* Only two layers exist: global and scope-local; scoped registrations do not inherit downward to subagents
* Subtree behavior is expressed through lineage data, never through scope structure
* Global tools filtered out by a restriction are indistinguishable from nonexistent tools ("visibility, not permission")

## Invariant Five: Branded Ids Prevent Interchange

> Ids passed between packages are branded — structurally strings, but not interchangeable at the type level.

```ts
/** A string carrying a compile-time-only brand B. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

`SessionId`, `CallId`, `JobId`, `ApprovalRequestId`, `GoalId`, `FsTargetKey`, `FsVersion`, … — you cannot pass a `SessionId` where a `CallId` is required; it is rejected at compile time. The `Branded<B>` primitive lives in the zero-dependency `dsh-brand` package, so any package can brand the ids it owns.

## Invariant Six: Closed Unions End on Discriminant Tags

> Switch on the tag; closed unions end in assertNever, merge-extensible unions fall through a documented default.

| Union | Nature | Termination |
|---|---|---|
| `StreamChunk` | closed | `assertNever` (a new variant is a compile error at every consumer) |
| `SessionEvent` | merge-extensible | `default` passes unknown plugin events |
| `TurnEndReasonMap` | merge-extensible | `default` passes |
| `PreToolDecision` / `PostToolDecision` | closed | exhaustive |

## Invariant Seven: Misconfiguration Fails Loud

> Misconfiguration fails loud at load; never silently skip a missing reference.

* Plan-mode `section` missing/blank/non-string → plugin load fails
* Permission presets require the isolating shell executor + approval service → misconfiguration fails at load
* Duplicate tool/prompt-section registration → throws
* An unknown event type without `ignorable: true` → the reader refuses to rebuild the session rather than silently dropping it

## How the Invariants Are Checked

| Mechanism | What it checks |
|---|---|
| `dsh-session/invariant` plugin | turn and step numbering, execution-event closedness, tool call/result pairing |
| `dsh-tool-workflow/invariant` | the workflow run protocol (one start, member end pairing, no updates after end) |
| Runtime-invariant companion (AGENTS.md) | checks authoritative event streams or mutable data, not service/method presence |
| Docs gates | `verify-cordis-catalog`, `verify-tool-catalog`, `verify-type-equiv` (pasted type declarations must not drift) |

## Design Trade-offs

These invariants are not "good habits" — they are **mechanically checkable contracts**, and so:

* Wrong implementations are rejected at compile time (branded ids, assertNever on closed unions) instead of being discovered at runtime
* Wrong configuration is rejected at load time (fail loud) instead of silently degrading
* Wrong listeners are rejected by monotonicity (guards) instead of being overridden

This is exactly the confidence behind "no privileged kernel needing patches": extension points have contracts, contracts have gates, and gates have tests.
