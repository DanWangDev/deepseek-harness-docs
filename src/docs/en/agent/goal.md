# Same-Session Goals: Durable Completion Objectives

> A goal is a single durable completion objective attached to an existing session: the `create_goal`/`get_goal`/`update_goal` tools plus the `/goal` human command, the `active`/`paused`/`blocked`/`complete` phases evolving by revision number, and the Goal Round continuation mechanism.

## What a Goal Is

A **goal** attaches to an existing session rather than being a separate conversation:

* it is **durable state** (a `goal/change` session event), not a scheduler and not a scheduling queue
* the session log remains its source of truth—forking, resuming, and compaction carry the goal along automatically
* its work proceeds through **continuations**: the same-session driver realizes a Goal Round as a goal-triggered turn

```ts
/** Durable continuation phase. Activation is process-local and separate. */
type GoalPhase =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'complete'
```

## Data Model

```ts
/** Compare-and-set identity for one exact goal revision. */
interface GoalRef {
  readonly id: GoalId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}

/** Full durable state written by every non-clear goal mutation. */
interface GoalSnapshot extends GoalRef {
  readonly objective: string
  readonly phase: GoalPhase
  readonly blockedReason?: GoalBlockReason   // present only when phase === 'blocked'
  readonly maxGoalRounds: number
}
```

* `GoalId` is a branded id; every approved durable mutation increments the revision—tools compare-and-set on `{ id, revision }`
* **`blocked` is the only durable state meaning "stopped due to a problem"**: it carries a stable lower-kebab-case code plus a human/model-readable explanation
* `GoalView` additionally projects `roundsStarted`, `createdAt`, `updatedAt`, and the process-local `activation` (`armed`/`disarmed`)

## Goal Rounds and Activation

* **Goal Round**: one continuation cycle accepted on behalf of the current goal. The same-session driver realizes a Goal Round as a goal-triggered turn, which may contain zero or more steps; **unrelated human turns in the same session do not consume the Goal Round cap**
* **Activation**: the process-local permission (`armed`/`disarmed`) for the continuation consumer to accept the next Goal Round. It deliberately takes no part in durable replay—**after a resume or fork, automatic work can start only after a subsequent human-authorized resume change via `/goal` or the model tools** (disarmed is the safe default)

## Tools and Commands

| Tool | Behavior |
|---|---|
| `create_goal` | Creates a goal (requires root permission directly from a human) |
| `get_goal` | Reads the current goal (including the exact id/revision, phase, completed continuation rounds, and the round cap) |
| `update_goal` | Mutates the goal: `edit`/`pause`/`resume` require human root permission; `complete`/`blocked` accept the exact current Goal Round; `blocked` has a default floor of 3 approved Rounds |

`/goal` is the human command provided by `dsh-command-goal`—it directly observes or changes the current goal, and its output is UI state; the goal domain owns every durable, model-visible record.

## Durable Mutations

Every mutation is a durable `goal/change` session event whose payload is either the complete snapshot after the change or a clear tombstone. Strict folding and the durable projection derive lifecycle state only from these events—**inbox changes do not affect goal state**.

```text
create_goal("Fix CI")      → goal/change { phase: 'active', revision: 1 }
[Goal Round 1: turn → step → tool]
update_goal(revision=3, pause) → goal/change { phase: 'paused', revision: 4 }
resume                        → goal/change { phase: 'active', revision: 5 }
complete                      → goal/change { phase: 'complete', revision: 6 }
```

## Relationship to Task Management

`todo_write` is the **execution checklist** within a session (a full snapshot, a UI checklist); a goal is the session-level **completion contract** (durable phase, round budget, blocked reason). The former answers "how far along", the latter "why continue, and for how long"—both are stored as session events and both replay from the log.
