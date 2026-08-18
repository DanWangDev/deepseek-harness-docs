# Plugin Development: From Registration to Effect

> A hands-on walkthrough of the full DeepSeek Harness plugin development chain: from the `apply(ctx)` entry point, `inject` dependency declarations, registration side effects and disposers, to distribution as a bundle and patch-layer config overrides.

## A Minimal Plugin

A Cordis plugin is an object with optional `inject` and `apply(ctx)` fields:

```ts
import { Context } from '@deepseek-ai/cordis'

// declare dependencies: start only when the services are ready
export const name = 'my-plugin'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: Context) {
  // register a tool (the defineTool DSL handles schema and validation)
  ctx.tools.register(defineTool({
    name: 'my_tool',
    description: 'Do something useful.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: { schema: { type: 'object' } },
    execute: async (args) => ({ echoed: args.input }),
  }))

  // register a prompt section (order decides the splice position)
  ctx.systemPrompt.section({
    name: 'my-plugin:guidance',
    order: 120,
    text: 'When asked about X, prefer Y.',
  })

  // listen for events (registrations returning a disposer are auto-undone)
  ctx.on('session/event', (session, event) => {
    console.log(session.id, event.type)
  })
}
```

**Registrations are reversible side effects**: `ctx.effect()` / `ctx.on()` return disposers; they are undone as expected on reload and teardown. When a plugin unloads, the tools it registered disappear from the prompt and refuse to execute—indistinguishable from tools that never existed.

## The Five Core Concepts, Reviewed

| Concept | In the plugin |
|---|---|
| A plugin is an object that implements a Service | An `apply(ctx)` function or a `Service` subclass |
| The context is the container of services | Services are looked up by keys such as `ctx.tools`, `ctx.llm`, `ctx.sessions` |
| `inject` declares dependencies | Starts only when the services are ready; load order is expressed through dependencies |
| Typed event communication | Declaration merging extends the event map, dispatched by `@mode` |
| Registration is a reversible side effect | Every registration corresponds to a disposer |

## From Plugin to Bundle

For plugin code to reach a running dsh, it needs a **composition entry** (a row in cordis.yml) plus mounting code. A bundle is the distribution format for "config items + mounting code":

```yaml
# sample cordis.patch.yml (a bundle's patch file)
services:
  my-plugin:                      # locates the entry by id
    config:
      option: value
```

A patch **replaces the whole row** of config by id (no deep-merge); `dsh.profile.bundles` lists the bundles a profile stacks. Load order: the bundles listed by the profile → the profile's `cordis.patch.yml` → the home level → any `--patch` overlay.

## The Complete Tool-Development Checklist

| Step | Key points |
|---|---|
| Define the schema | `defineTool({ name, description, parameters, output, execute })`; `parameters` is an implicitly open object root, with required properties marked `required: true` |
| Declare the output | `output.schema` (an enforced JSON Schema subset) + `render(args, value)` as a pure projection |
| Handle cancellation | `execute` must observe or forward `exec.signal` and settle only after its own work reaches quiescence |
| Declare concurrency | `isConcurrencySafe(args)` returns `true` when overlapping with siblings is allowed; otherwise stay exclusive |
| Declare a timeout | `timeoutMs` (a cooperative budget; `dsh-tool-call-timeout-policy` implements the `tools/execute` wrapper) |
| Declare presentation | `presentCall`/`presentResult` return card render intents (`generic`/`terminal`/`diff`/`search`/`read`/`web`) |
| Write the README | The package contract: config, semantics, limitations, extension points, and Model Experience |

## Registry API Quick Reference

| Registry | Method | Semantics |
|---|---|---|
| `ctx.tools` | `register(def)` / `restrict(filter)` / `guard(fn)` / `schemas(scope)` | register / filter / monotonic guard / allowlist projection |
| `ctx.systemPrompt` | `section(s)` / `context(c)` | prompt sections / dynamic context |
| `ctx.commands` | `register(def)` | human commands (slash commands, not through a model turn) |
| `ctx.jobs` | `start(jobStart)` | background task registration |
| `ctx.agents` | `create()` / `resume()` | create / resume agents (through the factory) |
| `ctx.llm` | register adapters | add model providers |
| `ctx.subagents` | register providers | add delegation backends |

## Common Pitfalls

* **waterfall listeners must call `next()`**: returning without it short-circuits—purely observational listeners must delegate
* **guards are monotonic**: returning a reason rejects, and no later listener can undo it; a guard has no allow result
* **model-visible implies logged**: any new model-visible input requires a new session event, rendered from the log
* **`DEFAULT_*` constants are not configuration**: deployment-varying options are validated `Config` fields changeable from cordis.yml
* **registry-subject events are not filtered**: events about the registry itself keep unfiltered dispatch

## Further Resources

* Tutorial: [Cordis Tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-tutorial/index.zh.md) (7 lessons, from your first plugin to harness in practice)
* Hands-on: [Extension Cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/extension-cookbook.zh.md) (feature → capability mapping)
* Package templates: [adding-a-package](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-package.zh.md), [adding-a-tool](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-tool.zh.md)
