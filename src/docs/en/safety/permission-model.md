# The Approval Model: ask/never Decisions

> A deep dive into DeepSeek Harness's user-approval seam (`packages/interaction/user-approval`): how every tool call is adjudicated through `tools/pre-execute`, how `ask`/`never` policies apply per session, how the audit event pair is persisted — and the design guarantee that the seam "cannot be bypassed."

## One Core Question

The user-approval seam answers one question: **may this specific operation proceed?** It owns a shared request/result vocabulary, the `ctx.approval` dispatch service, the `approval/request` answerer waterfall, a log-only audit event pair, and a per-session `ask`/`never` policy.

Callers (such as `dsh-tools` and `dsh-tool-bash`) consume closed results and **deny unless the result is `allowed-once`** (fail closed).

## Result Vocabulary: Closed and Fail-Closed

```ts
/** Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn request, or unavailable answerer. */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

* `allowed-once` authorizes only **that one** operation that was asked about
* Callers deny on `rejected`, `cancelled`, and `unavailable` alike
* **A missing answerer, one that does not own the request, one that throws, or a non-compliant one yields `unavailable`, never a grant**

Each request receives a fresh `ApprovalRequestId` — the branded id pairs the `approval/asked` and `approval/decided` audit events while preventing approval ids and tool-call ids from being interchanged.

## Per-Session Policy: ask / never

```ts
/** A session's approval policy — what happens to an ask BEFORE any interactive answerer sees it. */
type ApprovalPolicy = 'ask' | 'never'
```

| Policy | Behavior | When to use |
|---|---|---|
| `ask` (default) | delegates to the composed answerer chain; with no answerer it falls through to fail-closed `unavailable` | interactive use |
| `never` | deterministically returns `rejected`, dispatching no answerer | CI, unattended, strictly headless |

The effective value is **the last `approval/policy` event in the session log**, falling back to the service configuration — `setApprovalPolicy(session, policy)` is the only write path, so replay can rebuild the override value.

## Request and Adjudication Flow

```ts
/** Readonly same-process permission question. callId links to an already presented tool call. */
interface ApprovalRequest {
  readonly agent: Agent
  readonly toolName: string
  readonly callId?: CallId
  readonly reason?: string
  readonly signal?: AbortSignal
}
```

The full flow of `ctx.approval.request(req)`:

```text
Requirement: the requesting session is inside a turn that has not ended
  → append approval/asked (audit)
  → never policy? → deterministic rejected (before waterfall dispatch!)
  → approval/request waterfall: the answerer chain
     the first answerer returns a result (otherwise delegate via next())
  → append approval/decided (audit, paired)
  → complete with that result
```

**`never` is enforced inside the service, before waterfall dispatch** — even an answerer registered later with `prepend` cannot bypass it.

## Integration with the Tool Pipeline

An `ask` decision in `tools/pre-execute` calls the approval service:

```text
tools/pre-execute (waterfall)
  → { kind: 'ask', reason } → ctx.approval.request({ agent, toolName, callId, reason })
      → allowed-once → proceed with execution
      → rejected / cancelled / unavailable → materialize as a deny error result
  → ToolGuard (monotonic) can still impose a final denial
```

Approval requests **deliberately omit tool arguments**: the answerer attaches its prompt to the already streamed-out tool call via `callId`, rather than rendering another copy that could drift.

## Audit: The ask/decided Event Pair

* Audit events are log-only and **never enter the model transcript**
* Model-visible behavior is the caller-derived tool result and the current runtime-context snapshot
* Both policies contribute their full current meaning to the **cache-safe runtime-context snapshot** — when the approval state changes, a fresh full snapshot is appended after the preserved history, without rewriting the system prompt in the request header

## Permission Presets: Binding Two Knobs into One

`dsh-permission-presets` (`ctx.permissionPresets`) binds the two independently enforced knobs — the sandbox mode `sandbox/mode` and the approval policy `approval/policy` — into named presets:

| Preset | sandbox | approval |
|---|---|---|
| `workspace-write` (default) | `workspace-write` | `ask` |
| `danger-full-access` | `danger-full-access` | `never` |
| `custom` (reserved name) | derived non-preset state | — |

Presets do not own enforcement — execution/prompt narration/replay still read each knob; `set(session, name)` only records intent and **writes through each knob's own setter**, so replay never needs to chase state. The isolation-requiring `ctx.shell` executor and `ctx.approval` are required; misconfiguration fails at plugin load.

## Comparison with the Reference Implementation

Claude Code's permission model is an Allow/Ask/Deny three-level system plus five layers of rule sources plus Denial Tracking runaway-loop protection. DeepSeek Harness's model is simpler but stronger:

| Dimension | Claude Code | dsh |
|---|---|---|
| Decision | allow / ask / deny | allowed-once / rejected / cancelled / unavailable |
| Rule sources | 8 sources merged by priority | session policy (ask/never) + composed configuration |
| Unbypassability | rules can be overridden by higher priority | monotonic guard: deny can never be flipped back to allow |
| Audit | settings writes + session records | `approval/asked` + `approval/decided` event pair (replayable) |
