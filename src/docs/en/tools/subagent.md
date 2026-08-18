# Subagents: Delegation and Orchestration

> A source-level analysis of the DeepSeek Harness subagent seam: how one agent delegates work to subagents, the lifecycle differences between one-shot and continuable background subagents, and how the `send_message`/`interrupt_agent`/`list_agents` control tools operate.

## Capability Positioning

The subagent seam lets one agent delegate work to subagents. Like bash, it is an **optional capability** outside the agent loop — but unlike other capability seams: **multiple provider implementations can coexist in the same context**, registered by name (`ctx.subagents`), whereas bash allows only one executor.

| Role | Package |
|---|---|
| Service Definition | `dsh-subagent` (`ctx.subagents` + vocabulary) |
| Service Provider (six) | `dsh-subagent-spawn-in-process`, `-fork`, `-acp`, `-codex`, `-claude-code`, `-dsh-sdk` |
| Consumer | `dsh-tool-subagent` (delegation), `dsh-tool-subagent-control` (`send_message`/`interrupt_agent`/`list_agents`), `dsh-tool-subagent-report` (child-side `report`) |

Providers range from "spawn a new subagent" (in-process) to "delegate a turn to another product" (codex/claude-code/acp) — one interface, many worlds.

## Two Kinds of Capabilities, Two Discovery Styles

Providers advertise their **start-time** features through a static descriptor:

```ts
/** Which START-TIME features a provider supports. */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

A request that depends on a capability the provider lacks is **explicitly rejected** (`SubagentError('UNSUPPORTED_CAPABILITY')`) — never accepted and silently ignored. **Continuable** subagents are assembled by the continuation executor manager itself, using method presence as the capability (`prepareContinuable`).

## One-Shot Start Request

```ts
/** What a caller asks for when starting a ONE-SHOT subagent. */
interface SubagentStartRequest {
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /** The spawning agent. */
  readonly parent: Agent
  /** Cancellation signal from the spawning context (the tool's exec.signal). */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  readonly outputSchema?: ObjectJsonSchema   // requires capability
  readonly maxDepth?: number                  // requires depthLimit
  readonly toolFilter?: ToolRestriction       // requires toolFilter
  readonly persona?: string                   // requires persona
}
```

* **`toolFilter`**: the in-process backend applies `tools.restrict()` in the child's creation window — filtered tools disappear from the child's prompt **and refuse execution** ("visibility, not permission"), with loud validation of unknown names
* **`persona`**: registered as the child's `deployment:persona` section, shadowing the deployment persona (strict `{{…}}` interpolation)
* **`maxDepth`**: absolute delegation depth ceiling (a non-negative safe integer)
* **`outputSchema`**: an object-rooted JSON Schema (the `assertObjectJsonSchema` subset); a successful child returns a matching `structured` value

## Continuable Subagents and Activation

A **continuable background subagent** is a persisted subagent session with at most one in-process **Activation** (the period during which a rebuilt subagent is resident):

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

* An Activation may execute multiple FIFO turns and stays resident while the descendants it created are still running
* The Agent inbox is the **single queue**: every continuation message becomes an `Agent.followup()` FIFO turn, and accepted messages share one observable order
* `followup()` routing depends only on Activation residency: `running` → enqueue; `waiting` → wake; no Activation → **cold resume** a new Activation

Authorization for follow-up operations comes from the exact online Agent tool context: the authenticated Agent must be the persisted subagent's **direct parent** as recorded in `SessionHeader.parentSession`.

## Control Tools

| Tool | Behavior |
|---|---|
| `subagent` | Delegates by provider (default `continuable`; runs in the background when arguments are omitted; the runtime delivers results automatically) |
| `subagent_fork` | Bound to the fork backend (`one-shot`; runs in the foreground when arguments are omitted) |
| `send_message` | Delivers follow-up messages to a continuable subagent (FIFO turns) |
| `interrupt_agent` | Calls `Agent.cancel(cause, { keepInbox: true })` on an online target — after the interrupt, one wake-up send resumes the paused FIFO queue |
| `list_agents` | Lists active subagents and descendants read-only (backed by session storage and the live registry) |
| `report` | The return channel registered by continuable in-process children: writes a user-role message to the direct parent session |

`interrupt_agent` authorization: `{ kind: 'user', parentSessionId }` (a human client presenting the persisted direct-parent address) or `{ kind: 'ancestor', agent }` (the online ancestor chain contains the caller). A wrong parent address is rejected with `UNAUTHORIZED`.

## Delegation Depth and Budget

`delegationDepth` is persistent session metadata — the subagent recursion budget survives restarts. A request's `maxDepth` limits the child's computed depth: delegations beyond the budget are rejected at start, preventing runaway recursive delegation loops.

## Boundary with Workflows

[Workflows](../tools/workflow.md) (the `workflow` tool) are "model-written orchestration scripts that start subagents" — the script starts subagents through `agent()`, and each subagent is owned by the Agent that initiated the run. subagent is a one-shot/continuable delegation primitive; workflow is scripted batch orchestration. The Ralph loop is a "foreground fresh-agent workflow toward an immutable objective" (see [workflows](../tools/workflow.md)).
