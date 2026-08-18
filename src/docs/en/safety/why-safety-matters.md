# Why Safety Matters: The Threat Model

> When an AI can operate on your real project files and run commands, where is the safety boundary? This page analyzes DeepSeek Harness's safety challenges, threat model, and defense-in-depth strategy — how approval, sandboxing, plan mode, and credential isolation each play their part.

## Threat Model: What Can Go Wrong

An agent harness holds **full filesystem and command-execution capability**. Threats layer by severity:

| Threat | Example | Defense |
|---|---|---|
| Malicious prompt injection | Web content induces the model to run `rm -rf /` | approval policy (ask/never) + sandbox (read-only) |
| Misoperation | The model edits the wrong file or runs the wrong command | observation policy (read before write), plan mode, diff rendering |
| Credential leakage | The model prints an API key to output | credential isolation (references only, never values), environment clearing |
| Runaway loop | Repeatedly requesting the same denied operation | monotonic guard, denial tracking, turn termination |
| Recursive delegation explosion | A subagent delegates subagents without bound | `delegationDepth` budget, `maxDepth` cap |
| Telemetry leakage | Anonymous identity and behavioral data exposed externally | anonymous UUID, disableable telemetry, explicit disclosure |

## Defense in Depth: Four Layers

```text
Layer 1: what the model sees (prompt engineering)
  system-prompt assembly · persona · plan:policy soft guidance
        ↓
Layer 2: is the operation allowed (approval)
  tools/pre-execute → ApprovalPolicy: ask | never
  ToolGuard (monotonic, cannot be revoked)
        ↓
Layer 3: what the process can touch (sandbox)
  ctx.sandbox → SandboxMode: read-only | workspace-write | danger-full-access
  bwrap/Landlock/Seatbelt/Windows-ACL backends
        ↓
Layer 4: what happened (audit and persistence)
  session event log · approval/asked + approval/decided audit pair
  hook/invoked + hook/result · model-visible means logged
```

## How the Defenses Work Together

### Approval: ask/never

Every sensitive operation passes through the `tools/pre-execute` waterfall before dispatch (see [approval model](../safety/permission-model.md)):

* `ask` (default): delegates to the answerer chain (UI channel / ACP machine decision); with no answerer it fails closed to `unavailable`
* `never`: deterministically returns `rejected`, **enforced inside the service, before waterfall dispatch** — even an answerer registered later with `prepend` cannot bypass it

### Sandbox: A Second Defense Beyond the Permission System

Even when approval grants passage, processes still run under the sandbox policy (see [sandbox mechanics](../safety/sandbox.md)): `read-only` denies writes, `workspace-write` confines to the workspace root and temporary areas, `danger-full-access` bypasses isolation (the consumer spawns the raw argv directly, without calling `ctx.sandbox`). **Approval and sandbox are configured independently and enforced independently** — plan mode's read-only, no-write stance is soft guidance; the real write restriction comes from the sandbox policy.

### Credentials: Values Never Land in Configuration

* settings sections and cordis.yml entries carry only **credential references** (`CredentialRef`); values belong to the `ctx.credentials` provider (env/file layer)
* Keys are write-only: the Web UI page only receives desensitized descriptors, plaintext keys are stored in `$DSH_HOME/.credentials.yaml`, and settings keep only the reference
* The local shell executor **clears credentials from the environment** before merging the caller's env
* Consumers re-resolve references per operation — credential rotation requires no restart

### Identity: Anonymous and Auditable

The anonymous identity is **a random UUID, one per harness home** (`$DSH_HOME/.anonymous-user-id`), never derived from hostname/network/git; deleting the file resets it, and different homes cannot be linked. Telemetry is reported via `ctx.sessionTelemetry`, and `DSH_TELEMETRY_DISABLED` can disable export (see [identity and telemetry](../internals/telemetry-identity.md)).

## Denial-Tracking Protection

The monotonic guard guarantees **no mechanism can flip a denied call back to allowed**: after the allow/deny/ask decision of `tools/pre-execute`, `ToolGuard` can only return a denial reason or `undefined` — so listener order can never turn a deny into an allow. This is the most fundamental difference from permission models whose "rules can be overridden."

## Safety-Related Configuration at a Glance

| Configuration | Location | Effect |
|---|---|---|
| `approval/policy` | session policy | `ask` / `never` |
| `sandbox/mode` | sandbox policy | `read-only` / `workspace-write` / `danger-full-access` |
| permission preset | `dsh-permission-presets` | binds sandbox + approval into named presets |
| `DSH_TELEMETRY_DISABLED` | environment variable | stops telemetry export |
| `enableRunInBackground` | bash tool config | removes the background-run argument |
| `delegationDepth` | session metadata | subagent recursion budget |

## Conclusion

DeepSeek Harness's safety philosophy fits in one sentence: **separate "what the model wants to do" (approval) from "what the process can do" (sandbox), make every decision auditable (logging), and make the defenses unbypassable (monotonicity)**. The next three pages break down the approval model, the sandbox mechanics, and plan mode one by one.
