# Workflows: Scripted Multi-Agent Orchestration

> The workflow seam lets an agent run **model-written orchestration scripts that start subagents** (the `workflow` tool): the script is plain JavaScript executed in a vm context on a worker thread, fanning out to multiple subagents through the `agent()`/`pipeline()`/`parallel()` hooks.

## Capability Positioning

Like subagents, workflows are an **optional capability** outside the agent loop. Like bash, only one engine implementation may provide `ctx.workflowEngine` per context — there is no named provider registry; a second engine replaces the first via plugin config.

| Role | Package |
|---|---|
| Service Definition | `dsh-workflow` (`ctx.workflowEngine` + vocabulary) |
| Service Provider | `dsh-workflow-worker-thread` (`node:worker_threads` engine — one worker per run, with the script's vm context inside it) |
| Consumer | `dsh-tool-workflow` (the `workflow` tool) |

## Start Request

```ts
/** What a caller asks for when starting a workflow run. */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  signal?: AbortSignal
}
```

`meta` and `args` are plain JSON data; the engine schema-validates `meta` and rejects invalid data with a loud error before any work begins — **the engine never obtains them by evaluating the script text**. `parent` is a required field — every subagent the script starts is owned by it; cwd, lineage, and depth are passed through the subagent seam.

## Script Hooks

Four orchestration primitives are available in scripts (plus `phase(title)` progress declarations and `log(message)` narration):

| Hook | Behavior |
|---|---|
| `agent(prompt, opts?)` | Runs one subagent to completion; with `opts.schema`, validates and returns a structured object; resolves `null` on failure |
| `pipeline(items, ...stages)` | Runs each item through the stages in sequence with **no barrier between stages**; a stage throw drops that item to `null` and skips its remaining stages |
| `parallel(thunks)` | Runs zero-argument functions concurrently and awaits all (a barrier); a throw resolves `null` |
| `phase(title)` / `log(message)` | Progress presentation: `phase()` calls match `meta.phases` titles for observers; **implies no execution structure** |

## Failure Discipline: `WorkflowError.fatal`

Hook misuse inside scripts — bad arguments, unknown or deferred `agent()` options, schemas outside the structured-output subset, exceeded caps, seam start failures, cancellation — all throw `WorkflowError` with `fatal: true`:

* The `parallel()`/`pipeline()` combinators **re-throw** fatal errors directly instead of mapping the item to `null`
* A misspelled option must fail loudly and terminate the script, never dissolve into what looks like an ordinary subagent failure
* Per-item `null` is reserved for child run failures (non-`completed` stop reasons) and ordinary script errors within a stage

## Live Runs and Terminal States

```ts
/** Holder-owned live workflow. result never rejects; consumers may cancel and must call dispose(). */
interface WorkflowRun {
  readonly id: WorkflowRunId
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  cancel(reason?: string): void
  dispose(): Promise<void>
}
```

* `result` never rejects: a script failure settles as `stopReason: 'error'`
* After a run is cancelled, the result settles to `cancelled` within the engine's **bounded grace period**, after which the worker-thread engine terminates the worker hosting the script — consumers awaiting `result` never hang indefinitely
* `dispose()` performs cancellation, waits for bounded settlement, and waits for subagents to fully stop

```ts
interface WorkflowResult {
  value: unknown          // the script's materialized return value (host JSON; null when nothing is returned)
  stopReason: WorkflowStopReason  // 'completed' | 'cancelled' | 'error'
  error?: string
  agentsStarted: number   // the number of agent() calls accepted during the run
}
```

## Events and Persistent Records

The `workflow/*` events (`workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end`) are **observation-only** emits: payloads begin with `WorkflowRunInfo` (id + meta) rather than the live run, so subscribers cannot obtain `cancel`/`dispose`; `workflow/end` deliberately omits the result value. Each emit is isolated per listener — an exception thrown by a subscriber is logged and does not propagate.

The top-level consumer projects presentation facts onto the parent Session that invoked it: it writes `tool-workflow/run-start` once the run is accepted, and `tool-workflow/run-end` once the result is obtained and dispose has fully stopped (`runId + seq` paired members). `dsh-tool-workflow/invariant` validates the same protocol: exactly one start per run, member ends must pair, and no updates after the run ends.

## Typical Use

```js
// Example script the model writes for the workflow tool
const files = await agent({ label: 'list-packages', prompt: 'Enumerate all packages in the repository' }, {
  schema: { type: 'object', properties: { pkgs: { type: 'array', items: { type: 'string' } } }, required: ['pkgs'] },
})
phase('audit')
const results = await parallel(files.pkgs.map(pkg => () =>
  agent({ label: pkg, prompt: `Audit ${pkg}'s dependencies` })))
return { results }
```

A workflow is the ability to "write fan-out as code": one call, multiple subagents executed in parallel or in a pipeline, results returned structurally — this is the scale path for multi-agent orchestration. The Ralph loop is its specialization (a foreground fresh-agent workflow toward an immutable objective); the `ralph` tool starts a fresh structured child each Round.
