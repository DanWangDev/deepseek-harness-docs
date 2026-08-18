# What Is DeepSeek Harness

> DeepSeek Harness is an agent harness that runs on Node.js: it is not a chatbot but an **everything-is-a-plugin**, Cordis-driven agent runtime platform — reading code, editing files, running commands, and debugging programs in your project directory, and persisting all of it in a replayable event log.

## One-Sentence Definition

DeepSeek Harness (abbreviated `dsh`) is an **open-source agent harness**. It is not bound to any UI: the Web interface, the CLI, the headless one-shot runner, and the Agent Client Protocol (ACP) automation server are just different shells over the same core. Three keywords are key to understanding it:

| Positioning keyword | Meaning |
|---|---|
| **Agent harness** | A complete runtime platform carrying "model + tools + memory + strategy", not an API wrapper and not a single CLI |
| **Everything is a plugin** | Every part of the product is a Cordis plugin — the model adapters, the tool registry, the session log, and the agent loop itself; any part can be replaced from configuration |
| **Event sourcing** | Session history is an append-only `SessionEvent` log; the context the model sees is *derived* from the log, and replay, fork, resume, and telemetry all rebuild from the same event stream |

## Technical Positioning: Architectural Differences from Peer Products

The difference from terminal-native tools such as Claude Code is not a feature list but an **architectural pattern**:

| Product | Architectural pattern | Runs in | Extension | History storage |
|---|---|---|---|---|
| **DeepSeek Harness** | Plugin-based harness (Cordis plugin tree) | Node.js process | plugins/bundles (cordis.yml) | event-sourced session log |
| Claude Code | Terminal-native agentic loop (single-file bundle) | local process | hooks / MCP / skills | JSONL transcript |
| Cursor / Copilot | IDE-integrated autocomplete + chat | inside the IDE process | IDE extension API | cloud |
| OpenHands | Docker-containerized agent runtime | container | SDK / CLI | workspace files |

The core difference: **DeepSeek Harness makes the loop itself a replaceable plugin**. `ctx.agentLoop` is just one concrete implementation of the public `Agent` contract (`dsh-agent-loop`); extension plugins depend on `ctx.agents` and never directly on agent-loop — so swapping a driver, adopting a different scheduling policy, or even delegating turns to another product requires no patching.

## End-to-End Example: From Input to Output

When you type "fix the failing tests in this repository" into the Web UI, here is what the system does:

```text
┌────────────────────────────────────────────────────────────┐
│1. Shell layer (dsh web → Web UI / CLI / ACP / Python SDK)  │
│    dsh --profile web starts the app; input → Agent inbox   │
├────────────────────────────────────────────────────────────┤
│2. Loop layer (core/agent-loop — ctx.agentLoop)             │
│    turn/start → claim inbox → assemble prompt + schema     │
├────────────────────────────────────────────────────────────┤
│3. Assembly layer (core/system-prompt — ctx.systemPrompt)   │
│    sections by order + ctx.tools.schemas() tool list       │
├────────────────────────────────────────────────────────────┤
│4. Model layer (llm/llm — ctx.llm)                          │
│    agent/request → llm/stream streaming → assistant/chunk* │
├────────────────────────────────────────────────────────────┤
│5. Tool layer (core/tools — ctx.tools)                      │
│    tool/call → pre-execute approve → execute → post-execute│
│    → actual: bash / read / write / grep / subagent ...     │
├────────────────────────────────────────────────────────────┤
│6. Persistence layer (core/session + persistence)           │
│    model-visible facts → SessionEvent → JSONL/SQLite       │
└────────────────────────────────────────────────────────────┘
```

A typical agentic turn may contain multiple steps; each step is one model request plus the tools it calls:

| Step | AI decision | Tool call | Result |
|---|---|---|---|
| 1 | Look at the test output first | `bash("pnpm run test")` | 3 failing test cases |
| 2 | Locate the failing files | `grep("it(.*fails", "src/")` | locations of the test files |
| 3 | Read the source code | `read("src/foo.test.ts")` | the test code |
| 4 | Fix the implementation | `edit("src/foo.ts", old, new)` | file modified |
| 5 | Verify the fix | `bash("pnpm run test")` | all pass |

Each step is the model's autonomous decision — it decides which tool to use, what arguments to pass, and when to stop. That is what "agentic" means; and **every model-visible input at each step is appended to the session log**, a hard runtime invariant that distinguishes DeepSeek Harness from other products (see [Runtime Invariants](../internals/invariants.md)).

## What It Is Not

* **Not a chatbot**: the output is not a plain-text reply but actual file modifications, command executions, and state changes
* **Not an API wrapper**: it has its own tool system, permission model, context engineering, session management, and plugin ecosystem
* **Not a monolithic kernel**: there is no privileged kernel that needs patching — you extend dsh by mounting plugins alongside other plugins; every registration is a side effect and is automatically undone when the plugin is unloaded
* **Not a blind executor**: every sensitive operation passes through both an approval policy (`ask`/`never`) and a sandbox policy (`read-only`/`workspace-write`)

## Why "Everything Is a Plugin"

Pluginization is not a slogan but four concrete benefits:

* **Replaceability**: swapping a model provider, a filesystem backend, or even the entire loop implementation requires only a composition-configuration change
* **Composability**: a running `dsh` is a plugin tree built by a profile stacking bundles and patch layers in order; `--dump-config` prints the actual configuration tree on your machine
* **Auditability**: every registration has a corresponding disposer (resource-release function) that unwinds as expected on reload and teardown, with no leaked global state
* **Self-modification**: plugins can dynamically define, run, and stop other plugins (see [Self-Modification](../agent/self-modification.md)) — the underlying capability of the extension ecosystem

The cost is the need to understand Cordis's plugin model (five core concepts suffice to get started, see [Cordis: The Foundation of Everything-as-a-Plugin](../core/cordis.md)) and the attendant loading-order, scope, and event-dispatch semantics.

## Quick Start

```sh
# Run directly from npm (starts the Web UI at http://127.0.0.1:3080)
npx @deepseek-ai/dsh web

# Run from source
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install && pnpm run build
pnpm dsh web
```

After startup, open **Settings → Models**, enter your DeepSeek API key, select a workspace, and you can start a conversation (see [Web UI](../features/web-ui.md)).
