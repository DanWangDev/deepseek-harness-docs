# Filesystem Tools: Atomic Read/Write/Edit

> An analysis of the DeepSeek Harness filesystem capability (`packages/fs`): how the `read`/`write`/`edit`/`read_image` tools cooperate with the observation policy through the `ctx.fs` seam, delivering "read-before-write/edit" safe defaults and atomic operations.

## Capability Breakdown

The optional filesystem capability consists of four parts:

| Package | Responsibility |
|---|---|
| `dsh-fs` | `ctx.fs` + atomic text operations with optional guards (Service Definition) |
| `dsh-fs-local` | Local disk backend (Service Provider) |
| `dsh-fs-observation-policy` | Records observed present/absent states, adds freshness rules via `fs/*` events |
| `dsh-tool-fs` | Model-facing `read`/`write`/`edit`/`read_image` tools (Consumer) |

**Swapping the backend does not change the policy or the tool schemas** — that is the point of a capability seam.

## Read-Before-Write: The Observation Policy

Without `dsh-fs-observation-policy`, the filesystem seam is complete and unconstrained: `write` creates or overwrites unconditionally, and `edit` replaces literal text unconditionally. A deployment that loads `dsh-tool-fs` **is expected to load the observation policy plugin as well**, making "read-before-write/edit" the default behavior:

```text
Model: edit("src/foo.ts", old, new)
  → tools/pre-execute … allow
  → dsh-tool-fs calls ctx.fs.editText(target, old, new, expected?)
    → fs/edit-intent event (waterfall)
      → observation policy: the target must already be observed (read/write/list dir) → otherwise deny (FS_NOT_OBSERVED)
      → version guard: the expected version must match the current one → otherwise FS_STALE_VERSION
  → atomic replace or reject
```

It adjudicates the `fs/*` waterfall to change operations — removing the plugin does not break the tools, because the tools call `ctx.fs` and dispatch events rather than calling policy methods.

## Target Identity: The Opaque FsTarget

Each operation first resolves the user-supplied path into an opaque backend target:

```ts
/** A path resolved by a backend into a stable identity. */
interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  targetKey: FsTargetKey
  /** Path for model/UI-facing output. May be a local absolute path, workspace-relative path, or remote URI. */
  displayPath: string
}
```

Consumers may display `displayPath` but **must not interpret `targetKey`**, nor assume it is a local absolute path. Consumers that share an execution world with the filesystem obtain cross-capability coordinates from the provider: `processPath(target)` returns a normalized absolute path a subprocess can open, `fileUrl(target)` returns a `file:` URI, and `contains(parent, child)` checks normalized identity equality or descendant containment.

## Write and Edit Guards

The version guards on `writeText` and `editText` are both optional — omitting the guard performs an unconditional raw provider change:

| Guard | Semantics |
|---|---|
| `createIfAbsent` | Creates when the target is absent; rejects with `FS_NOT_OBSERVED` when it already exists. Must reject even if the target appears after the provider's initial probe — a publish operation itself must not replace |
| `replaceIfVersion` | Replaces only when the target exists and the version matches, otherwise reports `FS_STALE_VERSION` |
| (`expected` omitted) | Creates or overwrites unconditionally |

Version tokens (`FsVersion`) are derived by the backend from high-resolution stat identity and freshness fields; the policy layer stores them for staleness checks, and consumers **do not interpret their contents**. `lstat` is a path-level, non-following metadata primitive — consumers that need to check trust boundaries can reject `symlink`.

## Read Rendering: Windowed Views

The `read` tool renders a **windowed** code view: `offset` is the 1-based starting line of the window request, `lines` is the window content, and `totalLines` reports the file's total line count — `offset` is retained even when the window is empty, so a UI never presents a partial result as complete. `lang` is a language hint inferred from the extension, and `content` is a fallback text for UIs without read capability.

`stat` returns metadata (never content); `type` lets consumers reject directories and special files before reading; `size` lets text consumers choose `readText` vs `streamText` without probing by failure. Raw-byte consumers call `readBytes(target, signal, maxBytes)` — the required full-content cap makes overruns fail with `FS_TOO_LARGE` instead of truncating results or unbounded buffering.

## Tool Schema Highlights

| Tool | Behavior |
|---|---|
| `read` | Reads text files by window, renders a line-numbered code view |
| `write` | Creates or overwrites files; constrained by the observation policy and version guards |
| `edit` | Unique literal replacement; constrained by the same guards |
| `read_image` | Reads an image and creates a persistent attachment; requires `ctx.attachments` and a model route that supports image input, otherwise rejects |

`edit` is "unique literal replacement" — the replacement text must occur exactly once in the target, eliminating ambiguous overwrites at the root. This is the model-side atomic primitive for "change code": failure reports an error, success is one clean replacement, and both are persisted as `tool/result`.

## Boundary with the Command Tools

`str_replace_editor` (from `dsh-tool-str-replace-editor`) is a separate view/create/replace/line-insert tool built on the same filesystem seam, composable with any shell or terminal interface — it does not go through bash, so there is no shell injection surface. Design tradeoff: file editing goes through dedicated tools rather than shell commands, because dedicated tools provide guards, atomicity, and auditable `tool/call`/`tool/result` events.
