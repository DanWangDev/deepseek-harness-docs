# System Prompt Dynamic Assembly

> An in-depth analysis of DeepSeek Harness's System Prompt assembly mechanism (`packages/core/system-prompt`): prompt sections concatenated by order, dynamic context materialized on demand, tool schema allowlist projection — how scattered plugin contributions are assembled into a cache-friendly request prefix.

## One Core Design: A Registry, Not a Template

The System Prompt is not a hardcoded template but a **registry**: any plugin can register prompt sections (`PromptSection`) and dynamic context (`PromptContext`), which are sorted and concatenated by `order` at assembly. This turns "add a prompt section" into one registration call instead of editing a template file.

```text
Plugin A registers section("harness:identity", order=-100)
Plugin B registers section("deployment:persona", order=0)
Plugin C registers section("tool:guidance", order=150)
Plugin D registers context("workspace:notice", order=10)
         │
         ▼ assembly (per step)
   sections concatenated in ascending order
   + ctx.tools.schemas(scope) tool schema allowlist
         │
         ▼
   request/header event written to the log (EpochHeader.system + .tools)
```

## `PromptSection`: A Prompt Section

```ts
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Unique name — a duplicate registration throws. */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Convention: `-100` is the
   * harness identity, `0` the deployment persona, tool guidance uses 100–199;
   * other negative orders also render before the persona.
   */
  readonly order: number
  /** Static text or a provider evaluated at each assembly with that assembly's context. */
  readonly text: string | ((context: AssembleContext) => string)
  /** Treat this contribution as the complete system prompt. */
  readonly complete?: boolean
}
```

Key semantics:

* **`order` convention**: `-100` is the harness identity, `0` the deployment persona, tool guidance uses 100–199; negative orders also render before the persona. Once collaborative assembly completes, a valid `complete` section becomes the sole prompt section
* **`text` can be a function**: evaluated at each assembly with that assembly's `AssembleContext`; text may reference `{{variable}}`, interpolated later by `renderPrompt`
* **Duplicate registration throws**: a section of the same name can appear only once in an assembly

## `PromptContext`: Dynamic Context

`PromptContext` is the cache-safe counterpart to sections — dynamic model context is materialized as **persistent user-role snapshots**:

* The agent loop only logs one after the retained model history when the full current snapshot changes or is removed by compaction
* Text can be a function; empty text contributes nothing
* Each context entry has its own `source` and metadata (such as `{ kind: 'plugin', plugin: '…' }` + `form`)

The `form` vocabulary for message sources is semantic, never visual: `instructions` (directives from workspace files), `catalog` (a directory of available items), `snapshot` (current state; a later snapshot supersedes the earlier one), `notice` (what just happened, one-shot), `relay` (a message sent by another agent), `recall` (material pulled from another session log).

## Tool Schemas: Allowlist Projection

`ctx.tools.schemas(scope)` projects the tool definitions visible in the current scope into **model-facing `ToolSchema[]`**: only `name`, `description`, and `parameters` — execution and presentation callbacks such as `output`, `execute`, `finalizeContent`, `timeoutMs`, `isConcurrencySafe`, `presentCall`, and `presentResult` **never leak into the model request**.

Scope resolution gives each agent a different tool list: the global layer plus every ancestor on that agent's scope chain; scoped tools shadow the global ones of the same name, and restrictions filter the global tool set (see [Agent Scope](../core/scope.md)).

## Assembly Context

```ts
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /** Scope whose providers and waterfall listeners participate. */
  scope?: ScopeKey
  /** Explicit control signal for the turn that requested this assembly, when any. */
  signal?: AbortSignal
}
```

`AssembleContext` identifies the scope layer an assembly resolves against. `dsh-agent` adds the optional `agent` field; `assembleContextFor(agent, signal)` sets the explicit fields together. A bare assembly has neither a scope nor a signal.

## Cache-Friendly

The system prompt is the most expensive and most repetitive part of a request. Two mechanisms keep it cache-friendly:

1. **Incremental logging**: `request/header` records a new snapshot only when the request changes; dynamic context is appended only when the snapshot changes or compaction removes it — never rewritten every step
2. **Pure-function rebuild**: the request header is a pure function of the log, rebuilt from the latest snapshot after replay/resume/compaction, with no live mirror

## In Practice: Registering a Prompt Section

```ts
import { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.systemPrompt.section({
    name: 'my-plugin:guidance',
    order: 120,                       // tool-guidance range
    text: 'When the user asks about X, prefer approach Y.',
  })
  // the disposer is managed automatically by the effect: the section is revoked when the plugin unloads
}
```

This is the everyday shape of "everything is a plugin" — instead of adding text to a template, you register a section; it takes effect on reload and is undone on unload.
