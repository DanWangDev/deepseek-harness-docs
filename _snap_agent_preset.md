# Agent Preset: Assembling Capabilities per Session

> An agent preset is the mechanism for "each session having a different set of capabilities": one `agent.cordis.yml` describes an agent's composition, **standing-mounted** on demand into an isolated realm, with sessions joining through the scope parent chain—the preset is the assembler of the tools, prompts, and services the model faces.

## Why Presets

A single process can host many kinds of agents: the default "full-capability engineer", a read-only auditor, a pure-protocol agent in Code Mode, subagents bound to a specific backend… Their **tool sets, prompts, and services are completely different**.

Agent preset is designed for exactly this scenario: a preset is one `agent.cordis.yml` in a directory (plus an optional `preset.yml` carrying the `name`/`description` display text) describing that agent's composition.

## Standing Mounts and Isolated Realms

The key mechanism is the **standing mount**: the roster performs **one process-level standing mount per preset**—mounted under the roster service's own UNTRACED context (an isolated realm), with services resolved through each entry's own inject store. This yields three properties:

* **Shared**: when multiple agents join the same preset, they use the same composed instance—the same plugin objects, the same tool registrations, the same prompt sections (`composeFrom` is a bind, not a mount)
* **Standing**: a standing mount only composes plugins; it starts no agent, no session, no turn—cold transcript reads can still resolve tool presenters
* **Isolated**: services in an `isolate` realm are invisible to the outside, including the host—`serviceFor(agent, name)` is the only channel to read them from outside

<<FENCE>>

View resolution order: `agent → preset → global`—the entry on the nearest scope-chain layer wins for duplicate tool names.

## The Service: `ctx.agentPresets`

| Method | Behavior |
|---|---|
| `list()` / `resolve(id)` | Lists/resolves presets; not memoized—the root directory is re-read each time, so a preset written during process lifetime is immediately visible |
| `mount(agentCtx, id)` | Ensures the standing mount and attaches the agent's scope key to the preset layer; called from the agent factory's `setup(agentCtx)`; rejection rolls back creation |
| `composeFrom(agentCtx, parentCtx)` | Binds the child agent to the parent's **same** composed instance—synchronous, no composition-failure mode, does not read the roster |
| `recompose(agentCtx, id)` | Re-links to another preset; **only when the agent has produced nothing** (swapping tools mid-flight would make recorded tool calls unreproducible) |
| `standingKeyFor(id)` | The standing scope key for cold transcript reads |
| `copy(from, id, name?)` | The only authoring write: a whole-directory copy ("the copy loads exactly like the source") |
| `remove(id)` | Deletes a locally authored preset (those shipped with a release cannot be deleted) |

Switching presets records a log-only `agent-preset/selected` session event—so replay can reconstruct which composition the session was running on at the time.

## Relationship to Bundles

A bundle is the **distribution format** for "config items + mounting code"; a preset is the **session mechanism** for "assembling capabilities per agent". The two work together:

* profiles stack bundles in order (e.g. `dsh-base` provides the base row: model adapters, tools, persistence, sandbox/approval policy, settings, credentials, telemetry)
* presets customize per agent on top of the profile—when a service row needs an `isolate` realm, that service is visible only to agents joining the preset

<<FENCE>>

## Where Things Belong

| Goal | Mechanism |
|---|---|
| Give a session a different capability set | Assemble an agent preset; service rows inside it that need an `isolate` realm |
| Have a subagent inherit the parent's capabilities | `composeFrom` (bind the same composed instance instead of re-resolving) |
| Swap compositions mid-flight | `recompose` (agents that have produced nothing only) |

## Common Compositions

Profile templates shipped with the release: `web` (a browser app + coding persona) and `headless` (a one-shot runner, no server). `dsh-base` is the first-layer bundle of every profile; the platform-gated shell stack (win32 disables the bash sandbox and enables pwsh) is also handled at the bundle layer.
