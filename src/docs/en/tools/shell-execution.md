# Command Execution: Bash and PowerShell

> A source-level analysis of the DeepSeek Harness shell execution seam (`packages/shell`): how the `bash` and `pwsh` tools execute commands through `ctx.shell`, how `resolve()` splits requests from specs, how foreground results are reported orthogonally, and how the seam ties into sandboxing and background jobs.

## Capability Breakdown

The shell execution seam is a standard capability trio:

| Role | Package | Description |
|---|---|---|
| Service Definition | `dsh-shell` | `ctx.shell` + request/result vocabulary |
| Service Provider | `dsh-bash-local` / `dsh-bash-sandbox` | Local executor and sandboxed executor (Windows combinations use `dsh-pwsh-local` / `dsh-pwsh-sandbox`) |
| Consumer | `dsh-tool-bash` (`bash` schema) / `dsh-tool-pwsh` (`pwsh` schema) | Model-facing command tools |

In the Windows combination, `bash` is replaced by the `pwsh` dialect: paths take native `C:\...` form, variables use `$env:NAME`, and each invocation runs in a new process without a persistent PTY session.

## `resolve()` Split: Request vs Spec

The seam separates the **model-facing request** from the **fully resolved spec** the executor actually uses:

```ts
/** A caller's execution REQUEST: optional fields are filled by ShellExecutor.resolve from config. */
interface ShellExecRequest {
  command: string
  workdir?: string          // Default: implementation config
  timeoutMs?: number        // The implementation caps it
  stdoutMaxBytes?: number   // Foreground stdout capture budget
  signal?: AbortSignal
  stdin?: string            // Trusted in-process plugin input
  env?: Record<string, string>
  dshEnv?: DshEnvironment   // Managed DSH_* variables
  sandboxPolicy?: SandboxExecutionPolicy
}
```

The tool layer calls `ctx.shell.resolve(request)` between the two (the repo's "explicit over implicit at package boundaries" rule); `ShellExecSpec` carries the resolved values (`workdir`, `timeoutMs`, and `stdoutMaxBytes` are all required).

`stdin` and `env` are **trusted in-process plugin inputs**, not exposed by `dsh-tool-bash` (models that need stdin use heredocs or pipes). The local executor clears credentials from the environment before merging the caller's explicitly provided env.

## Foreground Runs: Orthogonal Result Reporting

The result of one completed (or killed) foreground run is reported **independently** — a process can time out and still exit with code 0 (because it caught the signal):

```ts
/** The outcome of one completed (or killed) foreground run. */
interface ShellRunResult {
  exitCode: number | null   // null when terminated by a signal
  signal: NodeJS.Signals | null
  timedOut: boolean         // Whether the executor's own timeout cut first
  aborted: boolean          // Whether caller cancellation intervened
}
```

A caller can never mistake an early-interrupted run for normal success — `timedOut`, `aborted`, `signal`, and `exitCode` are each independent fields.

## Background Jobs: Tying into Jobs

The `bash` tool's `run_in_background` argument (enabled by default) registers the command with the generic `ctx.jobs` runtime:

```text
bash("pnpm run test", run_in_background: true)
  → ctx.jobs.start({ kind: 'bash', label: 'pnpm run test', owner: agent })
  → returns a job id (bash-N)
  → the job_output / job_list / job_kill tools collect or stop it
  → completion is delivered via agent.inject() as user/message
```

Disabling the `enableRunInBackground` config (default true) removes the argument entirely. See [background jobs](../features/jobs.md).

## Tying into the Sandbox

The sandboxed executor (`dsh-bash-sandbox`) wraps the command argv in the sandbox runner before spawning:

```text
bash("rm -rf /etc")   sandboxPolicy = read-only
  → ctx.sandbox.confine(argv, policy)
  → runner argv: bwrap/Landlock/Seatbelt/Windows-ACL wrapper
  → denial dialects such as EROFS / EACCES / EPERM are recognized as denials
```

Denial and runner failure are treated distinctly: the former means the sandbox worked as intended and blocked a restricted command; the latter means the sandbox infrastructure itself failed. See [sandbox mechanics](../safety/sandbox.md).

## Execution Semantics Highlights

* **Each invocation runs in a new process**: no persistent shell state; use the `terminal_*` tool family (opt-in) when a persistent session is needed
* **`DSH_*` environment namespace**: harness-owned subprocess facts (e.g. `DSH_WEB_URL`); the executor drops any pre-existing `DSH_*` names from the environment before merging the managed snapshot, so current facts never inherit stale values
* **Output truncation**: foreground stdout has a capture budget; background jobs and stderr have their own output caps; truncation is reported via `truncated` and the full stream may spill to a file (see the spill mechanism in [search and navigation](../tools/search-navigation.md))

## Tool Schema Highlights

| Tool | Behavior |
|---|---|
| `bash` | Executes shell commands through `ctx.shell`; supports `run_in_background` |
| `pwsh` | PowerShell dialect in the Windows combination; one-to-one with the bash tool calls |

Command execution is the core of agent capability — **full shell access** means it can do anything you can do in a terminal, which is exactly why corresponding safety mechanisms are needed to constrain it (approval policies + sandbox policies; see the [safety](../safety/why-safety-matters.md) group).
