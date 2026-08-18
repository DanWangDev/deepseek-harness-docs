# Architecture Overview: A Detailed Look at the Plugin Layers

> From the composition layer to the infrastructure layer, a detailed look at DeepSeek Harness's plugin architecture. A source-level data-flow analysis based on `packages/` — a running dsh is a plugin tree composed of layers stacked in order at startup.

## One Core Fact: Everything Is a Plugin

DeepSeek Harness is built on [Cordis](../core/cordis.md): plugins contribute services, typed events, and reversible side effects to a shared context. **Every part of the product is a plugin**, including the model adapters, the tool registry, the session log, and the agent loop itself. Consequently every part can be replaced from configuration — there is no privileged kernel that needs patching.

## Composition Layer: Profiles and Bundles

A running `dsh` is a plugin tree composed of layers stacked in order at startup:

```text
Empty entry list
  ├── each bundle listed by the profile (in order)
  ├── the profile's cordis.patch.yml
  ├── the home-level cordis.patch.yml
  └── any --patch overlay (highest priority)
```

* **profile**: a named assembly stored in the Harness home. It lists the bundles it stacks, holds the out-of-tree plugins it installs, and saves the user's own `cordis.patch.yml`. `web` and `headless` ship with the distribution as templates.
* **bundle**: the distribution format for Cordis configuration entries and their mounting code — whatever it inserts can always be patched by layers above it. A patch locates an entry by id and replaces its entire config, or inserts a new entry.

| Bundle | Contents |
|---|---|
| `dsh-base` | The first layer of every profile: model adapters, tools, persistence, sandbox and approval policies, settings, credentials, telemetry |
| `dsh-web-app` | The browser application (Web UI) |
| `dsh-headless` | A one-shot runner with no server at all |

To see the configuration tree your machine actually starts:

```sh
dsh --profile web --dump-config
```

Any entry it prints can be replaced by your own patch.

## Core Packages: Six Backbone Packages

A turn flows through the six packages along the same loop, and each package contributes a `ctx.<key>` service to the Cordis tree:

| Package | Responsibility | `ctx` key |
|---|---|---|
| `core/session` | Append-only `SessionEvent` log and in-memory store — the single source of truth | `ctx.sessions` |
| `core/system-prompt` | Assembly of prompt sections and tool schemas | `ctx.systemPrompt` |
| `core/tools` | Scoped tool registry and the guarded execution pipeline | `ctx.tools` |
| `core/agent` | `Agent` interface, active-agent registry, and `agent/*` events | `ctx.agents` |
| `core/agent-loop` | The default driver implementing the public `Agent` contract | `ctx.agentLoop` |
| `core/scope` | Registration primitives scoped per agent | library, no ctx key |

`agent-loop` is the only concrete implementation of the public `Agent` contract, but extension plugins depend only on `agent` (including when they need to launch an Agent), never directly on `agent-loop` — **the loop stays replaceable**. The default composition that wires this backbone into a runnable agent is `examples/agent-spine-demo`.

## Turn Flow: A Source Trace of One Main Data Stream

A **step** is one model request plus the tools it calls. A **turn** contains zero or more steps: it opens before claiming the first input and closes when no work is owed anymore:

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`, `step/*`, `user/message`, `assistant/*`, and `tool/*` are **persistent session events**; the rest are live extension points across the three event domains. `agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are waterfalls (waterfall events), whose listeners must call `next()` to delegate onward; `agent/turn-stopping` is a serial event with no `next()`.

## Events: Three Event Domains

Events are the extension points, and choosing the right event domain is the first decision for most changes:

| Domain | Carrier | When to use |
|---|---|---|
| **Session events** | Persistent facts appended to the log and broadcast via `session/event` | When a fact must survive a reload |
| **Agent events** (`agent/*`) | Carry the active `Agent`: inbox, steps, state, requests, validation, continuation | When observing or intercepting work in progress |
| **Capability events** | Attach policies and adapters to a seam (`fs/*`, `tools/*`, `telemetry/*`) without importing the loop | When attaching a policy to a capability |

**Model-visible means logged.** Everything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts this. Therefore, adding a model-visible input requires adding a session event.

## Capability Seams: Three Roles of a Replaceable Capability

A **seam** is a replaceable capability comprising three roles:

| Role | Responsibility | Example (shell) |
|---|---|---|
| **Service Definition** | Declares the interface (a Cordis `Service` owning its own `ctx.<key>`) | `dsh-shell` |
| **Service Provider** | Implements the interface | `dsh-bash-local` / `dsh-bash-sandbox` |
| **Consumer** | Uses the service (usually a model-facing tool) | `dsh-tool-bash` |

A package may combine multiple roles (`dsh-llm` is both a Service Definition and a Consumer), but a single role is not itself a seam; **adding a capability means designing all three together**.

Seams are exactly why replacing one provider can change the whole product: the filesystem and process providers share the same execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP along with them, with no provider-specific fork. Subagent providers differ just as widely behind the same interface — from creating a new subagent to delegating a turn to another product.

## Where New Behavior Goes

| Goal | Mechanism |
|---|---|
| Add a model provider | Register its adapter on `ctx.llm` |
| Add a model-facing capability | Register on `ctx.tools`; its schema joins the prompt assembly |
| Give a session a different capability set | Assemble an agent preset; its service lines need an `isolate` realm |
| Add shell execution | Register a `ctx.shell` backend; the local backend spawns processes via `ctx.subprocess` |
| Add persistent terminal execution | Register a `ctx.terminals` backend and `dsh-tool-terminal` |
| Add user commands | Register on `ctx.commands`; they dispatch without a model turn |
| Add background work | Register on `ctx.jobs`; the `job_*` tools collect or stop it |
| Add filesystem access or policy | Register a `ctx.fs` provider, or listen to `fs/*` events |
| Constrain launched processes | Use a `ctx.sandbox` backend; consumers wrap argv before spawning |
| Intercept requests, tools, or turns | Use the corresponding `agent/*` or `tools/*` events |
| Add model-visible context | Call `agent.inject()`; it lands in the next approved request |
| Add UI or editor integration | Drive `ctx.agents` and render from `session/event` |
| Generate session titles | Register the single `ctx.sessionTitle` provider |
| Fork an active session | `ctx.sessions.fork(source, boundary?, childSessionId?)` |

## Four Core Design Principles

### Plugin as Boundary

Every registration is a reversible side effect: prompt sections, tool schemas, adapters, providers, and listeners are installed via `ctx.effect()` or `ctx.on()` and unwind as expected on reload and teardown. Load order is expressed through service dependencies (`inject`), not by hand-orchestrated startup sequences.

### Event as Extension Point

Interception and policy prefer events (the `agent/*`, `tools/*` waterfalls); direct capability calls prefer service methods. Waterfall listeners must call `next()` to delegate onward; returning without calling short-circuits.

### Log as Memory

The session log is the source of the context the model sees. `deriveMessages()` projects the model history from it, and the raw `assistant/chunk` events guarantee replay and UI fidelity. Forking, resume, transcripts, telemetry, and persistence all derive from that event stream.

### Scope as Visibility

A contribution (tool, prompt section, variable, restriction, listener) is either global or belongs to exactly one scope key. A scoped tool shadows the global one of the same name within that scope — the mechanism for tailoring persona and tool variants per agent.
