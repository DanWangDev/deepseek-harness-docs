# The Sandbox: Process Isolation

> A systematic walkthrough of DeepSeek Harness's process sandbox: the three `SandboxMode` file-effect policies, the four local backends bwrap/Landlock/Seatbelt/Windows-ACL, `full`/`partial` enforcement completeness, and how consumers distinguish "denied by the sandbox" from "the sandbox itself failed."

## What the Sandbox Is

The sandbox (`ctx.sandbox`) wraps **child-process argv that shares the host's filesystem and kernel** in a file-effect policy without coupling consumers to a platform-specific runner:

* This is a second defense **outside** the permission system — even when approval grants passage, the process still runs under the sandbox policy
* Network and process visibility are **not** within the scope of `SandboxMode`
* Containers, microVMs, and remote execution are sibling implementations of the full capability seam, not providers of `ctx.sandbox`

## Capability Breakdown

| Role | Package |
|---|---|
| Service Definition | `dsh-sandbox` (`ctx.sandbox` + vocabulary) |
| Service Provider | `dsh-sandbox-local`: Linux bwrap/Landlock, macOS Seatbelt, Windows ACL restricted-token backends |
| Consumer | `dsh-bash-sandbox`, `dsh-pwsh-sandbox` (and any consumer that needs to confine subprocesses) |

## The Three Modes

```ts
/** File-effect policy for confined processes. */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

| Mode | Allows | Notes |
|---|---|---|
| `read-only` | only required sinks (such as `/dev/null`) | denies writes; the POSIX runner grants the `/dev/null` the shell needs, while the Windows ACL runner grants no explicit writable root |
| `workspace-write` | workspace root + backend-defined temporary areas | the normal agent working mode |
| `danger-full-access` | everything | **bypasses isolation**; the consumer spawns the raw argv directly, without calling `ctx.sandbox` |

Only the first two modes can be sent to a provider; `SandboxPolicy` carries confined modes only.

## Enforcement Completeness: full vs partial

```ts
/** Enforcement completeness for this host. `partial` means an active backend or older kernel ABI cannot govern every promised file effect. */
type SandboxEnforcement = 'full' | 'partial'
```

Enforcement completeness is a **fact reported by the backend**:

* `full`: the backend governs every file effect the mode promises
* `partial`: the active backend or an older kernel ABI governs only a subset — **consumers that require absolute guarantees must reject or surface this distinction upward**

Current partial-enforcement cases include older Landlock ABIs and the Everyone and hard-link boundaries of the Windows ACL runner.

## Per-Call Policy

The complete enforcement policy is **resolved and carried per capability call** — it is not fixed on the provider:

```ts
/** The complete file-effect policy resolved for one capability call. */
interface SandboxExecutionPolicy {
  mode: SandboxMode
  /** Absolute root directory workspace-write may write under. */
  workspaceRoot: string
  sessionId?: SessionId
}
```

* A normal tool call derives `workspaceRoot` from the calling session's immutable cwd; the deployment configuration is the fallback when there is no agent
* The root is normalized by filesystem semantics first, then lexically — a cwd containing `symlink/..` identifies the directory the spawned process actually runs in
* Two consumers can be confined under different policies at the same time (bash under `read-only` while a confined subagent needs its state directory writable)
* An approved retry of a prompt is a **new call** carrying the wider policy

## argv Wrapping and Classification Dialects

`SandboxProvider.confine` returns what the consumer actually spawns:

```ts
/** A confine result: the argv to spawn in place of the caller's own, plus enforcement completeness. */
interface ConfinedArgv {
  argv: string[]                        // runner + profile + separator + caller argv
  enforcement: SandboxEnforcement
  denialSignatures: readonly string[]   // backend denial dialect (EROFS / EACCES / EPERM)
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

**Two orthogonal stderr classifiers**:

| Classifier | Meaning | Consumer behavior |
|---|---|---|
| `denialSignatures` | signs that a confined command was blocked while the sandbox is **working normally** | concludes "the sandbox denied this command" |
| `runnerFailureRules` | the sandbox runner **refused or failed before executing the command** | concludes "sandbox infrastructure failure", reported as an infrastructure problem rather than an ordinary task failure |

A `RunnerFailureRule` requires: the process exits non-zero (an optional exit-code gate is allowed) plus a fatal signature in some remaining stderr line; informative exclusions are removed by whole-line exact matching first — **the exit status alone can never prove a runner failure**.

## Consumer Flow (bash-sandbox as Example)

```text
bash("rm -rf /etc")
  → resolve the sandbox policy (session cwd → workspaceRoot, mode)
  → ctx.sandbox.confine(argv, policy)
  → spawn the wrapped argv (bwrap/Landlock/Seatbelt/Windows-ACL)
  → did the command fail?
      first check runnerFailureRules → sandbox failure, report an infrastructure error
      then check denialSignatures → sandbox denial, report "confined command blocked"
      neither matches → ordinary command failure (exit code)
```

## Platform Differences at a Glance

| Platform | Backend | Denial symptom | Known partial cases |
|---|---|---|---|
| Linux (modern kernel) | Landlock | `EACCES` | older ABIs |
| Linux (bwrap path) | bubblewrap read-only bind | `EROFS` text | — |
| macOS | Seatbelt | `EPERM` | — |
| Windows | ACL restricted token | environment ACL gaps | Everyone and hard-link boundaries |

## The Boundary with Approval

Approval answers whether **the operation the model wants to do** is granted passage; the sandbox answers what **the process can actually touch**. The two are configured and enforced independently: a `never` approval does not lift the sandbox, and a `danger-full-access` sandbox does not bypass approval. Permission presets (such as `workspace-write` + `ask`) only bind the two knobs into named presets; enforcement still belongs to each one (see [approval model](../safety/permission-model.md)).
