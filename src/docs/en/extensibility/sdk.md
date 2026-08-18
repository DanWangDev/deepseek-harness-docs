# SDK and Protocol: Automation Access

> DeepSeek Harness's automation access surfaces: the TypeScript SDK over newline-delimited JSON-RPC 2.0, the automation-only Agent Client Protocol (ACP) server, the `dsh` CLI's profile system, and the Python SDK—four entry points, the same agent core.

## The Four Access Surfaces at a Glance

```text
┌─────────────────────────────────────────────────────────┐
│                   The same agent core                   │
│   ctx.agents / ctx.agentLoop / ctx.sessions / ctx.tools  │
└─────────────────────────────────────────────────────────┘
     ▲              ▲               ▲              ▲
     │              │               │              │
  Web UI       CLI (dsh)      JSON-RPC SDK    ACP server
  (browser)  (web/headless)  (TS + Python) (automation client)
```

## The JSON-RPC SDK

Three packages under `packages/sdk`:

| Package | Responsibility |
|---|---|
| `dsh-sdk-protocol` | Newline-delimited JSON-RPC 2.0 transport: one compact JSON frame per line; id+method = request, id = response, method = notification; malformed lines are ignored |
| `dsh-sdk-client` | TypeScript client |
| `dsh-sdk-jsonrpc-server` | stdio server: get-or-create one agent per `sessionId`; **stdout carries protocol frames only** |

**The wire surface** (three methods + four notifications):

```text
initialize → { serverInfo: { name: 'deepseek-harness-sdk-runtime', version } , maxTokens }
session/prompt { sessionId, content } → { messageId }      ← returns a receipt on enqueue
shutdown → flush → dispose → exit 0

Notifications: session.event (all sessions, unfiltered) / session.status (running/idle)
      subagent.started / subagent.finished (in-process only)
```

Known limitations: no protocol version negotiation (`serverInfo.version` is `0.0.1` and unvalidated), and no cancel/session-close methods.

## ACP: Automation Only

`@deepseek-ai/dsh-acp` is an **Agent Client Protocol** server (JSON-RPC over stdio, `AgentSideConnection` driving `ctx.agents`)—a **transport adapter** that exposes no UI concepts such as editor navigation/replay/commands/modes.

| Method | Behavior |
|---|---|
| `initialize` | Advertises only the image prompt on demand; advertises no session/editor/terminal/fs/MCP capabilities |
| `session/new` | A fresh agent with an absolute cwd; rejects non-empty `additionalDirectories`/`mcpServers` |
| `session/prompt` | Order-preserving text plus inline images; one in-flight per session; reports `end_turn`/`cancelled` at quiescence |
| `session/update` | Emits `agent_message_chunk` per committed `assistant/message` chunk |
| `session/request_permission` | Bridge-owned approval requests carrying a tool call id: one-shot allow/reject |

Limitations: fresh sessions only, raster images only (PNG/JPEG/WebP/GIF), committed answers only. The primary client is `dsh-subagent-acp`; `pnpm run demo:acp` starts the demo.

## Typert: Type-Safe Remote Calls

The Host↔Client remote method call layer (`ctx.typert` + `ctx.typertGateway`): business services declare methods open to the Client with `@Remote` / `@RemoteScope(key)`; complex Host objects map to wire identities through `TypertLookupMap` (e.g. `Agent` → `agentId`). Requests send only an endpoint plus named `args`; cooperative cancellation = the last `signal: AbortSignal` parameter. The Client uses concrete functions (`ctx.remote.<namespace>`) rather than a Proxy.

## CLI: the Profile System

```sh
dsh web                        # = --profile web alias; starts the Web UI
dsh --profile headless "task"   # one-shot runner, no server
dsh --profile <name>           # any named profile ($DSH_HOME/profiles/<name>)
dsh plugin --profile <name> <pnpm args>
dsh --profile web --dump-config   # prints the actual composition tree
```

Layer order: bundles (in `dsh.profile.bundles` order) → the profile's `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays. The launcher parses only its own flags and hands everything else to the booted profile. `headless`'s core execution capability is the Code Mode worker: the task is submitted as an ordinary user message, it waits for quiescence, flushes the Session, prints the last non-empty assistant text to stdout, and exits through `ctx.appExit` (`turn/end` completed → 0, otherwise 1).

## The Python SDK

`deepseek-harness-sdk` (module `deepseek_harness`):

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run("Inspect the repository and fix the failing tests.", session_id="example-001")
print(result.final_response)
```

* the `DeepSeekHarness` context manager **lazily starts the bundled runtime** (the `deepseek-harness-runtime-bin` platform wheel) and reuses it until exit—no system Node.js required
* reusing the same harness and session id preserves the Bash processes owned by that session (working directory, exported variables, shell functions)
* `Session.run()` → `RunResult(session_id, final_response, finish_reason, events, notifications, session_root)`
* inherits the `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` environment variables

## Selection Guide

| Scenario | Entry point |
|---|---|
| A human working in the browser | `dsh web` (Web UI) |
| One-shot CI/CD tasks | `dsh --profile headless "task"` |
| Driving from a TypeScript program | JSON-RPC SDK (`dsh-sdk-client`) |
| Driving from a Python program | `deepseek-harness-sdk` |
| An automation client (an agent protocol besides MCP) | ACP server (`dsh-acp`) |
