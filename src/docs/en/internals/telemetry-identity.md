# Identity and Telemetry: Anonymous and Auditable

> DeepSeek Harness's anonymous-identity and telemetry mechanisms: a random UUID per harness home, the ledger/ops two-channel telemetry, the shared sharing status — and the complete answer to "which data leaves your machine."

## Anonymous Identity

`@deepseek-ai/dsh-anonymous-user-id` (`packages/identity/anonymous-user-id`) is a **shared library, not a Cordis plugin**:

```ts
getOrCreateAnonymousUserId()  // returns a random UUID v4, one per harness home
```

* Persisted as the single line `$DSH_HOME/.anonymous-user-id` (default `~/.dsh/`)
* **Never derived from hostname, network, or git** — it is simply a random UUID
* Deleting the file resets it; different homes cannot be linked
* The first write uses exclusive creation; concurrent losers adopt the persisted value

Its consumers:

| Consumer | Use |
|---|---|
| OTel telemetry backend | reported as the Resource `user.id` |
| `/feedback` acknowledgment | the acknowledgment text carries the same value |
| `dsh-llm-deepseek` | sends the `x-deepseek-harness-user-id` header |

## The Telemetry Seam

Telemetry is an **optional capability**: a Service Definition + capture coordinator `ctx.sessionTelemetry` (`packages/session/session-telemetry`); the deployment loads the Provider `dsh-session-telemetry-otel` (an as-configured OpenTelemetry JS SDK logging pipeline). The harness's responsibility ends at `emit()` — batching, retry, and queuing belong to the reporting SDK.

**The content never enters a model request** — telemetry only observes; it does not join the conversation.

### Record Shape

```ts
SessionTelemetryRecord {
  channel: 'ledger' | 'ops'
  time: number
  severity: 'info' | 'warn' | 'error'
  attributes: Record<string, unknown>
  body?: unknown
}
```

| Channel | Content |
|---|---|
| `ledger` | a **one-to-one mirror** of session-log events: attributes carry only `session.id`/`event.type`/`event.seq` (plus `session.cwd`/`parent_id`/`seed_length` where the header has them) |
| `ops` | operational events: `agent-error`, `shutdown` (deliberately without `event.seq`, so they are not mistaken for ledger rows) |

Detail discipline:

* Per `(turn, step)`, only the first `assistant/chunk` is emitted (the stream-started signal); the remaining chunks are dropped — `seq` gaps in transit are the norm
* ledger deduplicates by `(session.id, event.seq)`; ops tolerates duplicates
* Delivery is best-effort; the desensitization waterfall is `session-telemetry/record`

### Shared Sharing Status

```ts
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

Disclosed through the required member `ctx.sessionTelemetry.sharing`:

| Status | Meaning |
|---|---|
| `full` | telemetry export is on |
| `feedback-only` | only feedback direct acknowledgments (not through the telemetry pipeline) |
| `disabled` | fully off |

`DSH_TELEMETRY_DISABLED` only stops telemetry export — it does **not** affect feedback direct acknowledgments or the DeepSeek provider header (that `x-deepseek-harness-user-id` is identity, not telemetry).

## Feedback

`@deepseek-ai/dsh-message-feedback` is editable feedback on a single assistant message — a **local storage-domain sidecar**, deliberately separated from the immutable Session-level `feedback/record` event (not log content/projection, no telemetry handoff):

```ts
type MessageFeedbackRating = 'positive' | 'negative'
MessageFeedbackItem { messageId, rating, note?, version, createdAt, updatedAt }
```

`version` is a CAS token — concurrent edits are rejected as version conflicts.

## The Audit Panorama

Identity and telemetry answer two questions: **"who are you"** (an anonymous UUID that cannot be reverse-linked) and **"what happened"** (ledger mirror + session log). Combined with the session log's audit event pairs (`approval/asked` + `approval/decided`, `hook/invoked` + `hook/result`), the system presents to an external observer:

```text
Replayable session log (model-visible means logged)
  + anonymous identity (cannot be linked to a real user)
  + disableable telemetry (default state is disclosed)
  + local feedback sidecar (not reported)
```

That is the full meaning of "auditable from source" — in contrast to agent products with built-in telemetry that cannot be turned off.
