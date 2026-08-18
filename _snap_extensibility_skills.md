# Skills: the Skill System

> A deep dive into the DeepSeek Harness Skills system: from disk loading, frontmatter parsing, invocation policy (model/user invocable), and discovery priority to the model-facing `skill` tool—one complete skill lifecycle chain.

## What a Skill Is

A skill is a **reusable task instruction**: `<name>/SKILL.md` or `<name>.md`. A skill is optional instruction, not a session event—which is why its vocabulary lives in `packages/skill` rather than core. The model loads the body on demand through the `skill` tool, and the body is injected as a user/message via `agent.inject()` into the next request.

## Capability Breakdown

| Role | Package |
|---|---|
| Service Definition | `dsh-skill` (the `ctx.skills` registry) |
| Service Provider | `dsh-skill-filesystem` (local-directory provider), `dsh-skill-badge` (optional bundled-badge provider) |
| Consumer | `dsh-tool-skill` (the model-facing `skill` tool) |

## The Provider Registry

`ctx.skills` composes local, embedded, remote, or other providers:

* registration is synchronous; remote initialization and discovery belong to the await phase of `list()`
* it uses a **host + per-scope layered structure**: registrations land in the layer matching the caller context's scope, and reads merge the global layer with the observing scope's chain—the entry on the nearest layer wins outright for duplicate skill names
* the discovery cache is keyed by the resolved scope chain; provider and runtime changes emit `skills/change` invalidation events (without a diff; consumers re-`snapshot()`)

<<FENCE>>

## Local Discovery Priority

The bundled local provider scans each root in rank order:

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` (when configured) |

The project root is the nearest ancestor containing `.git` (falling back to the current cwd when none is found); when `ctx.fs` is available, the upward git-root search probes for `.git` through the filesystem service, so remote or sandboxed workspaces do not fall back to the host filesystem boundary. Chokidar watches directories for changes; a watcher failure leaves the current observation incomplete but does not hide readable candidates.

## Invocation Policy: model/user invocable

<<FENCE>>

The local provider reads the exactly-named kebab-case frontmatter keys `disable-model-invocation` and `user-invocable`; omitted fields default to `true`. All four combinations are preserved:

| modelInvocable | userInvocable | Effect |
|---|---|---|
| true | true | invocable by both model and human (default) |
| true | false | model-invocable only |
| false | true | human-invocable only (command catalogs) |
| false | false | retrievable only by trusted `ctx.skills.get()` callers |

## Skill Identity and Loading

* names are kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
* the local provider accepts directory bundles (`<name>/SKILL.md`) and flat Markdown files (`<name>.md`); nested recursive `**/SKILL.md` is not supported
* model-facing session catalogs use only the invocable skills' `name` and `description`—**never the body or absolute file paths**
* the full `SkillSummary` carries `whenToUse` (extra routing guidance), `source`, `provider`, and `resourceBase`

## The Model-Facing Tool

The `skill` tool (`dsh-tool-skill`):

* the consumer owns both the initial catalog and its replacement: when the catalog changes, it is injected via `agent.inject()` as a user/message **replacement** (`form: 'catalog'`)
* the model loads a skill body by name, and the body enters the next request as injected context with `form: 'instructions'`
* when discovery is incomplete (a provider failed), results must not be cached—the consumer keeps the last usable catalog filtered by itself and retries

## Lifecycle Chain

<<FENCE>>

## Comparison with the Reference Implementation

Claude Code's Skills system has "budget-aware description truncation, dual-mode execution (inline/fork), a permission allowlist, conditional activation, and dynamic discovery up to remote skill loading". DeepSeek Harness's version likewise loads from disk and supports frontmatter and dynamic discovery, but **introduces no separate execution mode**—a skill is injected instruction, and execution still goes through the unified tool pipeline; permissions and sandboxing are covered by the existing approval/sandbox policy, so no skill-owned permission allowlist is needed.
