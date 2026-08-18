# Cordis: The Foundation of Everything-as-a-Plugin

> Cordis is the vendored plugin framework underneath DeepSeek Harness: plugins contribute services, typed events, and reversible side effects to a shared context. Understand Cordis's five core concepts and you understand all of dsh.

## Five Core Concepts

- **A plugin is an object that implements a Service.** It can be a function with optional `inject` and `apply(ctx)` fields, or a `Service` subclass whose lifecycle Cordis mounts into the current context.
- **A context is a container of services.** A service occupies a stable `ctx.<key>` (such as `ctx.tools`, `ctx.llm`, `ctx.sessions`); other plugins look up services by key rather than importing a concrete implementation.
- **Declare service dependencies via `inject`.** Once a plugin declares the services it needs, it waits for those services to be ready before starting; load order is expressed through service dependencies, not hand-orchestrated startup sequences.
- **Typed events are used for communication.** Services register event names via TypeScript declaration merging, then dispatch them as `emit`, `waterfall`, `parallel`, or `serial`.
- **Registrations are reversible side effects.** Prompt sections, tool schemas, adapters, providers, and listeners are installed via `ctx.effect()` or `ctx.on()` and unwind as expected on reload and teardown.

## Dispatch Modes

Each event has one of the following dispatch modes and can only be dispatched through the corresponding method:

| Mode | Awaited? | Dispatch order | Returns a value? |
|---|---|---|---|
| `emit` | No | Listeners observe in registration order | No |
| `waterfall` | No | Listeners observe in registration order | Yes |
| `parallel` | Yes | All listeners observe the event in parallel | No |
| `serial` | Yes | Listeners observe in registration order | Yes |

The dispatch mode is part of an event's public contract. New harness events record their mode via the `@mode` tag so the generated catalog can cross-check declarations against dispatch call sites.

## Waterfall Semantics: Around-Middleware

`ctx.waterfall` is **around-middleware**. A listener receives `(...args, next)`. Calling `next()` runs the downstream listeners; the downstream return value comes back through `next()` to the current wrapping layer, which may wrap it and continue returning outward. **Returning without calling `next()` short-circuits**:

```text
Outermost listener (waterfall listener A)
  └─ next() ──► downstream listener B
                 └─ next() ──► default behavior (the caller)
                 ◄─ return value ───┘
  ◄─ wrapped return ──┘
```

Cooperative listeners typically mutate a shared request or decision object, then delegate. A listener may also choose to fully replace the result — downstream listeners will only see the replaced result. Use `prepend: true` only when a listener must run before ordinary registrations.

For single-decision events, short-circuiting is **by design**: a policy listener that holds the decision may return without calling `next()` (such as `agent/pre-step`'s reject or `tools/pre-execute`'s deny), while listeners that only annotate or observe must delegate.

## Typed Events: Declaration Merging

Nearly every extensible union type in dsh follows the same pattern: an interface keyed by discriminant tags (`…Map`), with the union derived via `keyof`. **Plugins add variants through declaration merging — without modifying the package that owns the type**:

```ts
// Schematic of the pattern
interface ThingMap {
  'a': { kind: 'a' }
  'b': { kind: 'b' }
}
type ThingKind = keyof ThingMap        // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]  // discriminated union

// A plugin extends it without touching the source package
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'my-plugin/event': MyPayload
  }
}
```

Six canonical maps use this pattern: `ContentBlockMap`, `MessageSourceMap`, `FinishReasonMap` (dsh-llm), and `TurnTriggerMap`, `TurnEndReasonMap`, `SessionEventMap` (dsh-session). The two large unions consumers most often `switch` on are `StreamChunk` (the streaming protocol) and `SessionEvent` (log entries) — `switch` on the tag, each branch narrows the type, and a misspelled tag fails to compile.

## Loader Configuration: `!!js` and Overlays

`@deepseek-ai/cordis-plugin-include` parses `!!js` as an expression node. After the declared injections activate, the loader interpolates an entry's `config` against that plugin's context, and interpolates its `disabled` field against the loader context at each mount decision; all other entry metadata stays literal. **When environment selects plugins, use overlays** (for example, stacking `--profile headless` with `--patch`), rather than hardcoding conditional logic in the configuration.

## Practical Rules

* Encapsulate behavior as plugins: tool-pipeline events belong to `ctx.tools`, model streaming to `ctx.llm`, live agent coordination to `ctx.agents`
* Prefer events for interception and policy; prefer service methods for direct capability calls
* Every registration should have a corresponding disposer: either return one from `ctx.effect()`, or let Cordis's helper methods handle it automatically
* If teardown order matters, put the related work in the same effect so resources are released in the expected order

## From Framework to Product

Cordis provides the generic skeleton of "plugin + context + event"; DeepSeek Harness defines the product vocabulary on top of it: `SessionEventMap` (session facts), `ctx.tools` (the tool registry), `agent/*` events (active agents), and capability seams (the Service Definition / Provider / Consumer triad). The following chapters unpack this vocabulary one by one — the next stop is the [Agentic Loop](../core/the-loop.md) that drives it all.
