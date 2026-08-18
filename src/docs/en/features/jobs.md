# Background Jobs: Long-Running Management

> The shared vocabulary of long-running producers, the `ctx.jobs` runtime, and the job-control tools: how bash background commands, PTY sends, and subagents are read, listed, and killed through the same set of `job_*` tools.

## Why Background Jobs

Agents often need to start work that "runs for a long time": `pnpm run test` (minutes), long builds, background polling. If every tool call blocked waiting for completion, the agent would get stuck — and once the model output is truncated or the turn ends, foreground work can be taken down with it.

The background-job runtime (`ctx.jobs`) **decouples** "long-running work" from the tool call:

```text
bash("pnpm run test", run_in_background: true)
  → ctx.jobs.start({ kind: 'bash', label: 'pnpm run test', owner: agent })
  → returns a JobId immediately (bash-N)
  → the model can continue with other work
  → job_output reads output / job_list lists / job_kill kills
  → completion notification delivered via agent.inject() as user/message
```

## Producer Contract

```ts
/** Producer declaration passed to JobRegistry.start. */
interface JobStart {
  kind: JobKind              // also the id prefix (bash, subagent, …)
  label: string              // one-line model-visible label
  outputLimitBytes?: number  // UTF-8 byte cap per complete completion notification/output read
  owner?: Agent              // owning agent; its dispose cancels and waits on the job
  run(): JobHooks            // called after preflight; a throw registers nothing
}
```

```ts
/** Hooks through which the runtime controls and observes producer work. */
interface JobHooks {
  cancel(reason?: string): void        // synchronous, idempotent, settles as done
  done: Promise<JobOutcome>            // resolves after the producer releases resources (not when work finishes)
  readOutput?(): string                // consumes output since the last call
}
```

Access control rests on **owner authorization** (`ownerSession` carries the shared `SessionId`), not on the secrecy of the id.

## State and Snapshots

```ts
type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
```

`JobSnapshot` is a **read-only projection** built fresh each time (a new object, never live registry state). `JobOutcome.status` is the producer-reported three-state terminal outcome: `completed` (finished), `killed` (cancelled), `failed` (failed), with a kind-specific `detail` (such as `'exit code: 3'`, `'max-tokens'`).

## The Three Tools

| Tool | Behavior |
|---|---|
| `job_list` | lists jobs (kind, label, status snapshot) |
| `job_output` | reads output since the last read (streaming jobs); blocks while waiting on a job |
| `job_kill` | requests cancellation (synchronous, idempotent, settles eventually) |

`dsh-tool-jobs` is agnostic to job kind: **bash background commands, PTY sends, and subagents are all read, listed, and killed through the same 3 tools**. Loading the plugin hooks up the controllers, enabling producers' `ctx.jobs.start()`.

## Completion Notifications

A completion listener renders the `JobOutcome` as a model-visible completion notification (injected via `agent.inject()` as a user/message):

* `outputLimitBytes` is the byte cap per complete notification — a status line like `'exit code: 3'` does not eat the output budget
* The `reported` field suppresses the completion notification: when another interface has already delivered or promised to deliver the terminal state (such as the automatic delivery of a subagent result), it is not notified again
* Draining teardown cancellations of the owner or the service count as well

## Coordination with the Tool Family

| Producer | Via | Backgrounding |
|---|---|---|
| bash/pwsh tools | `run_in_background: true` argument | register with `ctx.jobs`; `enableRunInBackground` can remove the argument |
| terminal_send | `run_in_background: true` | registers with `ctx.jobs` |
| subagent | background mode (`continuable` default) | activation managed via `ctx.subagents`, results delivered automatically via the `subagent` tool |

## Example Flow

```text
Model: bash("pnpm run test", run_in_background: true)
  → tool/result: { jobId: "bash-3" }
Model: todo_write([...])   ← keeps doing other work
  ← user/message: "Background job bash-3 completed: exit code 0"
Model: job_output({ job_id: "bash-3" })  → full output
```
