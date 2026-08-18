# 仓库布局：包的地图

> DeepSeek Harness 的 monorepo 布局：`packages/` 下的包分组、vendor 的 Cordis 源码、docs 分层与示例组合——从仓库结构读懂产品边界。

## 顶层布局

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

## 分组规律

| 组 | 主题 | 代表性包 |
|---|---|---|
| `core/` | 产品 API 主干：会话、提示词、工具、agent、循环、作用域 | `core/session`、`core/tools`、`core/agent-loop`、`core/scope` |
| 能力族 | 每个 seam 三个包：Definition/Provider/Consumer | `shell/*`、`fs/*`、`web/*`、`subagent/*`、`skill/*`、`workflow/*`、`compaction/*` |
| `interaction/` | 人类交互：审批、权限、命令、ask-user | `user-approval`、`permission-presets`、`commands` |
| `bundle/` | 可安装的 profile patch 层 | `base`、`web-app`、`headless` |
| `sdk/` + `acp/` + `api/` | 自动化接入面 | JSON-RPC SDK、ACP 服务器、Typert 网关 |
| `util/` | 零依赖工具库 | `brand`（品牌化 ID 原语） |

## 命名约定

* 每个 npm 包是 `@deepseek-ai/dsh-<name>`；vendored 包被 rescope 并 `private: true`
* `@deepseek-ai/cordis` 是每个 harness 包的 peerDependency（+ dev）
* 全部 ESM（`"type": "module"`）；跨包用包名导入，本地相对导入用 `.ts`

## 一个 seam 的三个包

以 shell 为规范范例：`packages/shell/shell`（Service Definition：`ctx.shell`）、`packages/shell/bash-local` + `packages/shell/bash-sandbox`（Provider）、`packages/shell/tool-bash`（Consumer）。角色需要独立演进时通常位于不同包，但属于同一关注点时一个包也可以承担多个角色（`dsh-llm` 同时是 Service Definition 和 Consumer）。

## Docs 分层

仓库的 `docs/` 采用严格的分层（每种事实只有一个家）：

| 层 | 内容 |
|---|---|
| `docs/architecture.md` | 有序地图：组合、核心包、循环、seam、扩展点 |
| `docs/subsystems/*.md` | 每个子系统一页：类型定义、语义、生成的 Cordis API |
| `docs/cookbook/*.md` | 分步指南（adding-a-package、adding-a-tool……） |
| `docs/user/*.md` | 产品面向用户指南（Web UI、providers、Python SDK） |
| 生成目录 | `tool-catalog`、`config-catalog`、`persistence-catalog`、`module-graph`（从源码生成，新鲜度门禁） |
| `.agents/notes/` | Agent Notes：决策记录（为什么、放弃了什么、如何验证） |

## 从布局读懂产品

* **没有 `cli/` 主包**：CLI 是 `apps/cli` 上的薄 launcher，真正的组合在 bundles/profile——"外壳可替换"
* **没有 `kernel/`**：`core/` 不是特权内核，只是"每个组合都会启动"的包集合——"一切皆插件"
* **能力族三件套**：每个 seam 都有 Definition/Provider/Consumer——"能力是完整的"
* **生成目录有门禁**：tool/config/persistence catalog 由脚本从源码生成并被 freshness gate 校验——文档与代码同步是机械保证，不是习惯
