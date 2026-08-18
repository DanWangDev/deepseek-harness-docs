# Hooks: Claude Code/Codex Bridging

> Explains DeepSeek Harness's Hooks bridging from the source code: how Claude Code and Codex `hooks.json` events are bridged onto the harness's typed interception points—the `dsh-hook-protocol` shared protocol library plus the two bridge plugins `dsh-hooks-claude-code` / `dsh-hooks-codex`.

## Design Philosophy: the Canonical Extension Surface Is the Harness's Interception Points

A "native hook" in DeepSeek Harness is just an **ordinary plugin**—typed interception points such as `agent/pre-step` and `tools/pre-execute` are the canonical extension surface. The Hooks bridge is only an **external `hooks.json` compatibility path**: it keeps your existing Claude Code/Codex hooks configuration working on dsh.

| Package | Role |
|---|---|
| `dsh-hook-protocol` | Shared wire-protocol **library** (not a plugin; registers and injects nothing): matcher, `runHook`, output parsing and merging |
| `dsh-hooks-claude-code` | Claude Code hooks bridge (Cordis plugin) |
| `dsh-hooks-codex` | Codex hooks bridge (Cordis plugin) |

## Protocol Library Primitives

<<FENCE>>

`runHook` never throws—when the executor rejects, it returns a `HookOutput` with exitCode `undefined`. Merge rules: permission **deny > ask > allow**, halt is sticky, block reasons are joined with `\n\n`, and `additionalContext`/`systemMessages` accumulate in order.

## Session Events: hook/invoked and hook/result

The bridge layer records a pair of **log-only** session events for every hook invocation:

* `hook/invoked` + `hook/result` are paired by `handlerId`
* `stderrSummary` is truncated to `stderrSummaryMaxChars` (default 500)
* not a `SurfaceEventType`—never enters the model transcript, but durably auditable
* recording must happen inside an already-open turn (`SessionStart` produces no hook records; it runs before turn 1)

## Claude Code Bridge Event Mapping

| CC hook event | Harness interception point | Behavior |
|---|---|---|
| `SessionStart` | `agent/session-start` (emit) | Injects `agent.inject()` context |
| `UserPromptSubmit` | `agent/pre-step` (waterfall) | deny → `PreStepDecision.reject` |
| `PreToolUse` | `tools/pre-execute` (waterfall) | deny/ask → `PreToolDecision.deny/ask` |
| `PostToolUse` | `tools/post-execute` (waterfall) | Inspects/replaces the result |
| `Stop` | `agent/turn-stopping` (serial) | Forces the next step via `steer()` |
| `SubagentStart` / `SubagentStop` | `subagent/start` / `subagent/end` (emit) | Injects / observes only |

Matcher subjects: tool names, the session source, and the constant `agent_type` = `general-purpose`. Multiple hooks at the same interception point run serially, folded most-restrictively. stdin carries `session_id` + `transcript_path` (via `ctx.sessionPersistence.locate(session.header)`).

## The Codex Bridge

The Codex bridge covers 5 of the 10 hook points (`PreToolUse`/`PostToolUse`/`SessionStart`/`UserPromptSubmit`/`Stop`); differences:

* **regex-only** matcher (no literal mode)
* snake_case payload plus `turn_id`/`model`, **no trailing newline**
* no plugin env, no pre-tool approval/rewrite
* `block` (exit 2) → `PreStepDecision.reject` / `PreToolDecision.deny`
* `transcript_path` sends `null` when absent

## Configuration

<<FENCE>>

Both bridges' `configPath` is process-level (per-session hook config is an unimplemented TODO).

## Blocking Text and Injection Sources

Injected context carries an explicit source `{ kind: 'plugin', plugin: 'hooks-claude-code' | 'hooks-codex' }`; blocking text is precise, e.g. `blocked by PreToolUse hook`—the model can clearly distinguish "blocked by a hook" from "tool failure".

## Working with the Permission Model

The hooks PreToolUse bridge inserts into the `tools/pre-execute` waterfall—before or after the approval service depending on registration order, but always passing through the monotonic `ToolGuard` (see [Approval Model](../safety/permission-model.md)): a hook can deny, but it cannot flip a call denied by another component back to allow.
