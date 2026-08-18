# Self-Modification: the Plugin as Runtime

> DeepSeek Harness lets agents define, run, and stop versioned Cordis packages—not toy scripts in a sandbox, but a **dynamic Package lifecycle**: a definition registry + vm sandbox + dynamic tool registration that lets an agent modify its own runtime.

## What Self-Modification Is

"Self-modification" means an agent (or plugin) dynamically creating new plugins at runtime and mounting them into the running Cordis tree. This is the foundational capability of the extension ecosystem: one plugin can define another without restarting the process.

The implementation is the **cordis toolset** (`@deepseek-ai/dsh-tool-cordis`, not in any tree shipped with the product; it requires explicit opt-in):

| Tool | Behavior |
|---|---|
| `cordis_define` | Defines a new dynamic Package (a versioned Cordis package) |
| `cordis_inspect_list` / `cordis_inspect_query` / `cordis_inspect_self` | Query runtime metadata (the parts approved for exposure) |
| `cordis_run` | Runs a dynamic Package |
| `cordis_stop` | Stops a dynamic Package |
| `cordis_undefine` | Undefines |

## The Dynamic Runtime

The toolset injects `ctx.dynamicCordisRunner`, provided by `@deepseek-ai/dsh-cordis-host-runner`—it owns the **definition registry** and the **vm sandbox**; without it in the composition, these tools do not activate.

```text
Model: cordis_define({ name, version, code })
  → the definition registry records the versioned package
  → cordis_run mounts the Package in the vm sandbox
  → the Package's apply(ctx) runs: registers tools, services, event listeners
  → dynamically registered tools appear in the next assembly (request/header records the toolset change)
  → cordis_stop unloads: registered side effects are undone via disposers
```

A running Package can register **additional model-visible tools** until it is stopped, undefined, or DSH restarts; when such a toolset change happens, the system records a **full, changed request header**—the model-visible-implies-logged invariant holds for dynamic tools too.

## Sandbox and Lifecycle

A `cordis_run` Package's code executes in the vm sandbox—it accesses the harness's plugin API (`apply(ctx)`) but runs in a controlled JS context. Dynamic Packages share the same contract as static plugins: registrations are reversible side effects, undone on dispose.

## Why This Matters

Self-modification turns "extending the harness" from a **development-time activity** into a **runtime activity**:

* an agent can define its own tools mid-session and use them immediately
* plugin authors can iterate on compositions without restarting the process
* new capabilities can be "forged on site" instead of being precompiled into the release

The cost is trust: dynamic Package code holds access to the real runtime—so the cordis toolset is **not enabled by default**, requires explicit opt-in, and its documentation explicitly notes it is "not in any tree shipped with the product".

## Related Mechanisms

* **HMR (hot module replacement)**: `dsh-client-hmr` and Cordis's reload mechanism let composition-layer plugins hot-update
* **Hooks bridging**: an external `hooks.json` is another extension path (see [Hooks](../extensibility/hooks.md))
* **Extensions seam**: the `packages/extensions` package group lets agents define versioned Cordis packages, run the host+browser halves, and query the runtime metadata approved for exposure before writing code (`ctx.cordisInspect`)

The three form the complete "runtime extension" picture: HMR is development-time hot updating, hooks are external script callbacks, and the cordis toolset with extensions is agent-driven dynamic definition.
