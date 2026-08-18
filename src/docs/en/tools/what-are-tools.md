# Tool System Design: The AI's Hands

> A deep dive into the DeepSeek Harness tool abstraction: from the `ToolDefinition` type, the `defineTool` DSL, the registration mechanism, and the guard-based execution pipeline to the rendering system — how tools become an agent's capability through a unified interface.

## What a Tool Is

A registered tool (`ToolDefinition`) consists of four parts:

| Part | Content |
|---|---|
| **Model-facing schema** | `ToolSchema`: `name`, `description`, `parameters` (JSON Schema) |
| **Canonical output declaration** | `output`: raw JSON Schema + pure projection function (`render` + optional `presentationMeta`) |
| **Execution function** | `execute(args, exec)`: returns the canonical lossless JSON value |
| **Presentation and scheduling metadata** | `finalizeContent`, `timeoutMs`, `isConcurrencySafe`, `presentCall`, `presentResult` |

```ts
/** A registered tool: its schema plus the execution function. */
interface ToolDefinition extends ToolSchema {
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  /** Run one accepted call and return only its canonical lossless-JSON value. */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /** Synchronous last-mile transform for model-facing content. */
  finalizeContent?(exec, result): ContentBlock[] | undefined
  /** Cooperative tool-call timeout budget in milliseconds. */
  timeoutMs?: number
  /** Pure synchronous classifier for overlap with sibling tool calls. */
  isConcurrencySafe?(args: unknown): boolean
  /** How to present the PENDING state of one call in a UI. */
  presentCall?(args: unknown): ToolCallView | undefined
  /** How to present the COMPLETED state. */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

**Execution and presentation callbacks never leak into model requests**: `schemas()` projects only `name`/`description`/`parameters`.

## `defineTool`: A Typed Schema DSL

First-party tools do not need hand-written validation — `defineTool({ name, description, parameters, output, execute, … })`:

* Infers the argument types from `ParameterSchemaSpec` and binds `validateArgs()`
* Infers the function body's return type from `OutputSchema`
* Throws `ToolArgsError` (`INVALID_ARGS`) on parameter mismatch; throws `ToolOutputError` (`INVALID_TOOL_OUTPUT`) on invalid output

The value schema vocabulary (`ValueSchemaSpec`) supports `string`, `number`, `integer`, `boolean`, `null`, `array`, `object`, the author-side-only `json`, and `oneOf`, which requires matching exactly one branch. Precise inference holds to 16 levels of container nesting, then relaxes to `JsonValue` — avoiding exhausting TypeScript's type instantiation stack.

## Execution Pipeline: A Guarded Waterfall

`ctx.tools.execute()` runs one call through seven stages in order:

```text
tools/pre-execute (waterfall)   → allow | deny | ask
ToolGuard (monotonic)           → reason = deny; undefined = allow
tools/execute (waterfall)       → dispatch wrapper: timeout, retry, metrics
tools/post-execute (waterfall)  → accept | replace | block
finalizeContent (definition-owned) → exactly-once final content transform
tools/result (emit)             → frozen final result
```

```ts
/** Pre-dispatch decision. `allow` runs the call; `deny` materializes an error; `ask` runs only after an approval service returns `allowed-once`. */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

Key invariants:

* **Guards are monotonic**: the `ToolGuard` return type deliberately omits an allow result — `undefined` preserves the waterfall's decision, and a returned reason can only reduce permissions, so later listeners cannot undo it
* **Arguments cannot be rewritten**: history, audit, UI, and execution must stay consistent
* **`ask` fails closed**: unauthorized, missing approval channel or service, or requests without an agent all become denials; only `allowed-once` proceeds to execution
* **Failure does not end the turn**: unknown tools and throwing tools both become structured errors (`ToolNotFoundError` → `UNKNOWN_TOOL`); the call fails but the loop continues

## Execution Scheduling: Parallel and Exclusive

```ts
/** Scheduling mode for one pending call. `parallel` may overlap with siblings; `exclusive` runs alone and forms an ordering barrier. */
type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }
```

The agent loop queries the registry for each pending call's execution mode and uses it to form exclusive barriers and a rolling pool of parallel execution. Only a classifier that returns exactly `true` from `isConcurrencySafe(args)` may run in parallel; unknown, hidden, undeclared, invalid, or throwing classifiers are all **exclusive** (fail-closed). A function body running in parallel must not mutate state owned by its parent.

## Results: Execution-Time Values vs Persistent Projections

A tool's canonical `value` exists only during execution: the loop persists only `content`, `error`, and `meta`. The registry materializes the persistent presentation fields before `tools/result`, so **live late observers see the exact execution-time value plus fields that are safe for later persistent appends**. Replay can reproduce the presentation but cannot reconstruct the canonical intermediate value.

## Render Intent: The Card Vocabulary

How a tool wants its call presented in a UI is **provider-agnostic** — `presentCall`/`presentResult` return the render intent of a `card` label, which the UI bridge layer dispatches on:

| Card | Purpose |
|---|---|
| `generic` | Default card (title + raw args) |
| `terminal` | Shell command → terminal card (output + exit status) |
| `diff` | File creation/modification → inline diff card |
| `search` | Completed discovery search (grep matches grouped by file / glob flat path list) |
| `read` | Completed file read (line numbers, optional syntax highlighting) |
| `web` | Completed web retrieval (structured `sources`/`answer`, or `url`/`statusCode`) |

`ToolCallKind` (`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`) selects icons for generic cards. host/client runtimes project this neutral vocabulary onto their own views.

## Tool Catalog at a Glance

| Tool family | Model-visible names | seam |
|---|---|---|
| Filesystem | `read`, `write`, `edit`, `read_image`, `glob`, `grep` | `ctx.fs` + `ctx.subprocess` |
| Command execution | `bash`, `pwsh` | `ctx.shell` + `ctx.jobs` |
| Web access | `web_search`, `web_fetch` | `ctx.web` |
| Task management | `todo_write` | session-owned state |
| Delegation | `subagent`, `subagent_fork`, `send_message`, `interrupt_agent`, `list_agents`, `report` | `ctx.subagents` |
| Orchestration | `workflow`, `ralph` | `ctx.workflowEngine` |
| Skills | `skill` | `ctx.skills` |
| Other | `ask_user_question`, `exit_plan_mode`, `job_*`, `terminal_*`, `session_*`, `create_goal`/`get_goal`/`update_goal`, `lsp`, `schedule_*` | each own seam |

The following pages break down these tool families one by one.
