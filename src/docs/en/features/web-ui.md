# Web UI: The Console in Your Browser

> DeepSeek Harness's default interaction surface: the browser application started by `dsh web`. From model configuration and workspace selection to session input and approval dialogs — the full presentation of agent capability in the browser.

## Starting It

```sh
npx @deepseek-ai/dsh web
```

Default address `http://127.0.0.1:3080`. The `dsh` process treats **the directory it was started in** as the default filesystem location; a fresh Web UI has no workspace selected, so you need to add one.

## Three Steps to Get Started

### 1. Configure a Model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save. The model route becomes available immediately — **no server restart needed**.

Keys are write-only: after saving, the page only receives a desensitized descriptor, the plaintext key is stored in `$DSH_HOME/.credentials.yaml`, and settings keep only its credential reference.

### 2. Select a Workspace

Click **Select Workspace**, add the project directory where `dsh` was started, then select it. The session input box is unavailable until a workspace is selected.

### 3. Run a Task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain plans. If an operation needs approval under the current permission policy, the Web UI asks you first.

## What's Behind the Interface

The Web UI is not "another product" — it is a composition layer on the same plugin tree:

```text
dsh-base (base capabilities)
  └─ dsh-web-app (browser surface bundle)
       ├─ coding persona (prompt section)
       ├─ Web host row: webserver, API gateway, workspace, projection cache, storage
       ├─ client plugin roster (client plugins run in the browser)
       └─ dsh-client-hmr (dev-time hot reload)
```

* The browser calls host services through the **Typert RPC gateway** (`ctx.remote`) — complex objects such as `Agent` map to wire identities
* UI rendering is driven by `session/event` and `session.status`: the session event stream → message list, tool cards, todo checklist
* Tool cards come from the render intents of `presentCall`/`presentResult` (`generic`/`terminal`/`diff`/`search`/`read`/`web`) — the tool describes itself, and the UI projects it into a view

## Approval Dialogs

When an operation needs approval, the Web UI presents the confirmation as one link in the answerer chain:

* `tools/pre-execute` returns `ask` → `ctx.approval.request` → UI dialog
* `allowed-once` authorizes only this one operation; rejection/cancellation/unavailability all count as denial
* Approval-state changes append a runtime-context snapshot after the preserved history — the model knows what permission environment it is in (see [approval model](../safety/permission-model.md))

## Server Notes

`dsh-host-webserver` is the `node:http` carrier for the browser GUI: named routes (`exact`/`prefix`) + a single-owner fallback slot + `tapIndex` translation. Config `{ host: '127.0.0.1' | '0.0.0.0', port }` — **no TLS/auth/origin policy**; binding `0.0.0.0` exposes the network; the `web-startup` provider **rejects `--host 0.0.0.0`** (an unsupported use case). `EADDRINUSE` fails startup.

## Next Steps

* [Configure model providers](../features/providers.md): catalog providers, custom OpenAI-compatible endpoints, image input
* [Use the Python SDK](../extensibility/sdk.md): programmatic access to the same capabilities
* [Develop plugins](../extensibility/plugins.md): add your own tools and settings cards to the Web UI
