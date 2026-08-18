# Human Commands: The Slash Plane

> Slash-prefixed directives that human-facing adapters interpret and execute through `ctx.commands` — **they never become model messages**. They differ both from model-facing tools and from shell commands executed through `ctx.shell`.

## The Command Plane

Human commands (`/plan`, `/goal`, `/compact`, …) are the **discovery, parsing, dispatch, cancellation, and result-rendering** mechanism owned by UI adapters and command plugins:

```text
User input: /plan
  → adapter parses → parseCommand() → ParsedCommand
  → scope resolution → CommandDescriptor (read-only view without a handler)
  → command/run event (records rawInput)
  → run the handler against the exact agent
  → CommandResult presented directly to the UI (not a tool result, not a session event)
  → command/done event
```

Unless a handler changes the durable domain another way, **command output is UI state** — commands need no model turn and no `tool/call`/`tool/result` events.

## Definition

```ts
/** Plugin-owned command registration. */
interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /** Whether command/run records rawInput. Defaults to true. */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

## Invocation and Result

```ts
/** Invocation passed to one registered command handler. */
interface CommandInvocation {
  readonly commandId: CommandId     // pairs with the command/run event
  readonly agent: Agent             // the exact target agent
  readonly rawInput: string         // exact text after the name (including the separator)
  readonly signal: AbortSignal      // cancellation signal owned by the UI request
}

type CommandResult =
  | { kind: 'success'; text?: string; sourceEventSeq?: number }
  | { kind: 'error'; text: string }
```

`sourceEventSeq` is an optional field, valid only for success results: it points at an earlier non-command event in the receiving session log — `command/done` persists the same reference, letting clients merge the command lifecycle with that domain projection.

## Commands Shipped with the Distribution

| Command | Provider | Behavior |
|---|---|---|
| `/plan [off|message]` | `dsh-plan-mode` | toggles plan mode; a non-empty message selects plan mode first, then submits via `agent.steer()` (see [plan mode](../safety/plan-mode.md)) |
| `/goal` | `dsh-command-goal` | observes or changes the current goal (see [same-session goals](../agent/goal.md)) |
| `/compact` | `dsh-command-compact` | manual compaction (see [context compaction](../context/compaction.md)) |
| `/list-agents` | standalone plugin | lists active agents (via session projections and the live registry) |

## The Boundary with Tools and Shell

| Dimension | Human command | Model tool | Shell command |
|---|---|---|---|
| Triggered by | human | model | model (via the bash tool) or plugin |
| Produces a model message | no | yes (tool/call event) | yes |
| Needs a model turn | no | yes | yes |
| Result goes to | UI state | session log + UI | session log + UI |
| Example | `/plan` | `bash`, `read` | `pnpm run test` |

## Registering a Command

```ts
import { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.commands.register({
    name: 'mystat',
    description: 'Print workspace statistics.',
    handler: async ({ agent }) => {
      const n = agent.session.events.length
      return { kind: 'success', text: `Session has ${n} events.` }
    },
  })
}
```

Command availability is decided by plugin composition: every adapter that consumes the registry sees all effective definitions.
