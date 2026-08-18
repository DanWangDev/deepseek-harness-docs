# Agent Scope: Visibility Is Lifecycle

> A contribution (tool, prompt section, variable, restriction, listener) is either *global* or belongs to exactly one scope key. Scoped registration determines both visibility and binds the lifecycle — one fact decides both.

## Why Scope Is Needed

A harness process usually holds multiple agents: the main agent, delegated subagents, and resumable background agents. They share the same `ctx` world but **should not see the same things**:

* A subagent should not see its parent's private tools
* One agent's persona must not pollute another's
* When an agent's lifecycle ends, its registrations must unwind with it

DeepSeek Harness solves this with a two-layer flat structure: the `scope/` library provides the vocabulary of identity, carrier, and scope layers, so the same registration context expresses both each agent's visibility and shared lifecycle ownership.

## Core Primitives

```ts
/** An opaque, identity-compared scope key. */
type ScopeKey = object
```

`ScopeKey` is an opaque object-identity marker — the shipped agent loop uses the active `Agent` object as its own key, but the primitive never inspects that object.

**Only two layers, flat by design**: scoped registrations do not inherit down to subagents; subtree behavior is expressed through lineage (`parentSession`, `delegationDepth`, `subagentDepth`) data, never through scope structure.

```ts
/** A minted registration scope and its quiescent disposal boundaries. */
interface Scope {
  /** Context through which scope-owned registrations are made. */
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  dispose(): Promise<void>
}
```

## Scoped Dispatch: Routing Events by Subject

`Scoped<T>` is a compile-time brand marker placed on the opaque routing receiver returned by `scopeTarget(base, key)`:

```ts
/** A routing-only event receiver built by scopeTarget. */
type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }
```

Scope-filtered event declarations use this carrier as their `this` type, while the actual event subject is still passed as an explicit argument. **Dispatch rules**:

* Events about an agent's activity dispatch with that agent's carrier — agent-scoped listeners only receive that agent's events
* Events about the registry itself (such as "a tool was added") are registry-subject events and stay unfiltered

For example, `agent/pre-step` is declared as `'agent/pre-step'(this: Scoped<Agent>, payload: {...}, next)` — only listeners within that agent's scope participate in its pre-step decision.

## Shadowing: The Most Specific Wins

Scoped tools, sections, and variables **replace the global ones of the same name** only within that scope:

```text
global tool register("bash", …)
agent A scope: register("bash", …)   ← A sees its own bash
agent B scope: (none registered)     ← B sees the global bash
```

This is the mechanism for tailoring persona and tool variants per agent. When the tool registry reads, it merges the global layer with the observing scope's chain: entries from the nearest layer win name collisions outright.

## Restrictions and Scope-Local Registrations

```ts
/** Per-scope filter over global tools. Restrictions intersect and do not affect scoped registrations. */
interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

`tools.restrict(filter)` filters the **global** tool set for a single scope (multiple restrictions combine by intersection); scope-local registrations merge in after the filter. Filtered-out global tools **appear neither in the prompt nor execute** — indistinguishable from tools that do not exist ("visibility, not permission"). A deny-only filter lets subsequently unlisted inherited tools through, while an allow list excludes them — so a delegated subagent keeps the tools its reporting depends on.

## Agent Context: `agent.ctx`

An agent's scoped context. Registrations made through it have scope visibility and their lifecycle binds to that scope as well (one fact decides both). The `Agent` handle exposes:

```ts
/** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
readonly ctx: Context
```

## Setup Window: Assembling the Scoped World

The creator's time slot for assembling an agent's scoped environment (`CreateAgentOptions.setup`):

* At this point the scope and agent objects already exist, but neither the agent nor the session has been published
* `agent/session-start` has not fired, and the first prompt has not been assembled
* **setup only registers; it never drives the agent** — a setup rejection, a commit throw, or the owner's dispose all roll back the transaction, and neither id is published

A subagent's creation window is exactly where the parent preset composition is bound via `composeFrom(agentCtx, parentCtx)` (see [Agent Preset](../agent/preset.md)).

## Lineage: Data, Not Structure

Parent–child relationships are carried as data: `parentSession` (persistent), `delegationDepth` (a persistent subagent recursion budget), `subagentDepth` (runtime). **Lineage never affects visibility** — it serves authorization (for example, a subagent's later operations require a persisted direct parent), budgeting, and auditing, not scope resolution.

## Terminology Cheat Sheet

| Term | Meaning |
|---|---|
| scope | The registration unit divided per agent; only global and scope-local layers exist |
| scope key | An opaque identifier compared by object identity; the active agent is the key of its own scope |
| scope carrier | The `thisArg` carried by scope-filtered dispatch |
| shadowing | Name resolution where the most specific wins |
| restriction | Filters the global tool set for a single scope |
| setup window | The creator's time slot for assembling an agent's scoped environment |
| lineage | Parent–child relationship facts carried as data |
