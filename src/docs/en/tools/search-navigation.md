# Search and Navigation: Locating with glob/grep

> An analysis of the DeepSeek Harness search and navigation tools: `glob` file matching and `grep` content search, high-performance code retrieval built on the bundled ripgrep binary (`@vscode/ripgrep`), helping the AI locate precisely across millions of lines of code.

## Why Dedicated Search Tools

File-read tools are precise access to "known paths"; search tools are discovery access to "unknown locations". Before acting, the agent must answer three questions:

* Where is this symbol defined? → `grep`
* Which files match this pattern? → `glob`
* What does the project structure look like? → a bounded enumeration via `glob("**/*")`

DeepSeek Harness makes glob/grep **unconditionally available discovery tools** (from `dsh-tool-fs-search`), spawning the bundled ripgrep binary through `ctx.subprocess` — no `rg` installation on the host and no shell layer involved.

## Execution Path

```text
Model: grep("interface Foo", "src/")
  → tools/pre-execute … allow
  → dsh-tool-fs-search spawns @vscode/ripgrep via ctx.subprocess
  → runs as an ordinary foreground call, never as a background job
  → matches grouped by file (search card, shape: 'matches')

Model: glob("**/*.test.ts")
  → the same subprocess path (ripgrep --files mode)
  → flat path list (search card, shape: 'paths')
```

Neither tool depends on a shell — no command injection surface, and no shell environment to configure.

## Result Caps and Spill

Search is a "potentially huge result" — a broad grep can return thousands of lines. The system's handling:

* When results exceed the cap, the **complete formatted list** is saved to a file through the optional `ctx.spillStore` backend
* The returned location info (the spill path) is available for subsequent reads/searches — in a co-located deployment, if the backend exposes a local path, the model can continue to `read` that spill file
* The `search` card's `truncated`/`total` fields report whether inline results were truncated — **a UI never presents a partial result as complete**

`sampleOverCapGlobResults` is a config deployments must explicitly opt into (off by default) — it makes glob results return a sample instead of failing when over the cap.

## Rendering: The search Card

A completed search is presented with the `{ card: 'search', shape, title?, truncated, total, … }` render intent:

| shape | Meaning |
|---|---|
| `matches` | grep results, matching lines grouped by file |
| `paths` | glob results, flat path list |

The view **carries no result text** — UIs without a search card fall back to the raw result content. `truncated`/`total` let a UI honestly show "only the first N entries are displayed".

## Relationship with ripgrep

`@vscode/ripgrep` is the precompiled ripgrep binary maintained by the VS Code team, distributed with the npm package:

* Cross-platform (macOS/Linux/Windows) with no system dependencies
* Supports gitignore-aware search semantics (consistent with the editor experience)
* dsh invokes it as a subprocess with `CollectedOutput`'s bounded collection (truncate + spill), keeping memory under control

## Tool Schema Highlights

| Tool | Behavior |
|---|---|
| `glob` | Matches file paths against glob patterns; `**` matches recursively |
| `grep` | Searches file contents with a regular expression; returns matches grouped by file |

Both run as ordinary foreground calls, never as background jobs — search is expected to be fast; genuinely long-running work should use the [background jobs](../features/jobs.md) channel.

## Design Tradeoff: Dedicated Tools vs Shell Commands

Like file editing, search goes through dedicated tools rather than shell commands (`rg "pattern" src/`):

* **Schema-ized**: the model gets structured path/match lists instead of text output that must be parsed
* **Render intent**: the search card maps directly to the editor/UI's discovery view
* **No shell injection surface**: arguments are validated against JSON schema and never interpreted by a shell
* **Auditable**: `tool/call`/`tool/result` events are fully persisted
