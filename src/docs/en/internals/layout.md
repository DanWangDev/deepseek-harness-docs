# Repository Layout: A Map of the Packages

> DeepSeek Harness's monorepo layout: package groups under `packages/`, the vendored Cordis source, the docs layering, and example compositions — reading product boundaries from the repository structure.

## Top-Level Layout

```text
vendor/      Vendored Cordis source — manifest + sync procedure in vendor/README.md
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and Typert RPC gateway
  typert/      type graph generator, loader, and runtime registry
  llm/         LLM capability: Service Definition/Consumer + DeepSeek providers
  e2b/         E2B POC: sandbox + FS/subprocess adapters
  shell/       bash capability: Service Definition + local/pwsh providers + shell Consumers
  subprocess/  subprocess capability + local process-tree provider
  terminal/    persistent sessions
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compaction/  compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable dsh --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  todo/        todo_write tool
  plan/        plan mode as logged state
  preset/      per-session agent composition from preset cordis.yml files
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  identity/    anonymous identity
  settings/    user-settings capability + file provider
  credentials/ credential-reference capability + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared app-bin glue
  sdk/         JSON-RPC protocol, server, and TypeScript client
  examples/    demo bundles (agent-spine + CLI/ACP/JSON-RPC bins)
  support/     dev/test infrastructure
  util/        zero-dependency utilities
python/      Python SDK and bundled runtime (see python/README.md)
native/      @deepseek-ai/node-addon-landlock-run source of record (see native/README.md)
examples/    Runnable cordis.yml leaves over packages/examples bundles
.agents/     Agent workflows and Agent Notes
docs/        architecture, generated catalogs, postmortems, cookbook
scripts/     repo gates and generators
website/     VitePress projection of selected bilingual docs/ sources
```

## Grouping Patterns

| Group | Theme | Representative packages |
|---|---|---|
| `core/` | product API spine: session, prompts, tools, agent, loop, scope | `core/session`, `core/tools`, `core/agent-loop`, `core/scope` |
| Capability families | three packages per seam: Definition/Provider/Consumer | `shell/*`, `fs/*`, `web/*`, `subagent/*`, `skill/*`, `workflow/*`, `compaction/*` |
| `interaction/` | human interaction: approval, permission, commands, ask-user | `user-approval`, `permission-presets`, `commands` |
| `bundle/` | installable profile patch layers | `base`, `web-app`, `headless` |
| `sdk/` + `acp/` + `api/` | automation access surfaces | JSON-RPC SDK, ACP server, Typert gateway |
| `util/` | zero-dependency utility libraries | `brand` (branded-id primitives) |

## Naming Conventions

* Every npm package is `@deepseek-ai/dsh-<name>`; vendored packages are rescoped and `private: true`
* `@deepseek-ai/cordis` is a peerDependency (+ dev) of every harness package
* All ESM (`"type": "module"`); import by package name across packages, `.ts` for local relative imports

## Three Packages per Seam

Using shell as the canonical example: `packages/shell/shell` (Service Definition: `ctx.shell`), `packages/shell/bash-local` + `packages/shell/bash-sandbox` (Provider), `packages/shell/tool-bash` (Consumer). Roles usually live in separate packages when they need to evolve independently, but one package can hold several roles when they share a concern (`dsh-llm` is both Service Definition and Consumer).

## Docs Layering

The repository's `docs/` follows a strict layering (one home per fact):

| Layer | Content |
|---|---|
| `docs/architecture.md` | the ordered map: composition, core packages, the loop, seams, extension points |
| `docs/subsystems/*.md` | one page per subsystem: type definitions, semantics, generated Cordis API |
| `docs/cookbook/*.md` | step-by-step guides (adding-a-package, adding-a-tool, …) |
| `docs/user/*.md` | product-facing user guides (Web UI, providers, Python SDK) |
| generated catalogs | `tool-catalog`, `config-catalog`, `persistence-catalog`, `module-graph` (generated from source, gated for freshness) |
| `.agents/notes/` | Agent Notes: decision records (why, what was given up, how to verify) |

## Reading the Product from the Layout

* **No `cli/` main package**: the CLI is a thin launcher over `apps/cli`; the real composition lives in bundles/profile — "the shell is replaceable"
* **No `kernel/`**: `core/` is not a privileged kernel, just the set of packages "every composition starts" — "everything is a plugin"
* **Capability-family triad**: every seam has a Definition/Provider/Consumer — "capabilities are complete"
* **Generated catalogs are gated**: the tool/config/persistence catalogs are generated from source by scripts and validated by a freshness gate — docs–code sync is a mechanical guarantee, not a habit
