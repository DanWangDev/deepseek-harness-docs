# Task Management: The todo_write Snapshot

> Unpacking the DeepSeek Harness task management system: how the `todo_write` tool maintains an agent's todo list through whole-list snapshots — a session state deliberately kept minimal, renderable in the UI as a checklist.

## Why Task Management

A long task can span multiple turns: fixing tests, refactoring modules, writing docs. The model needs memory of "where am I, what's next" — not free text hidden in the prompt, but **structured state that renders in the UI and is readable by the model**.

`todo_write` is that mechanism: session-owned state, and the UI renders the latest `todo/write` event as a checklist.

## Data Model: Deliberate Minimalism

```ts
/** One entry in an agent's todo list — the unit of the `todo/write` event's whole-list snapshot. */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

Note what is **deliberately omitted**: no id, no priority, no `activeForm` — because the list is **wholly replaced** on every write (last-write-wins), entries need no stable identity. Three statuses describe a complete portable lifecycle.

## Whole-List Snapshot Semantics

```text
Model: todo_write([{content: "Fix tests", status: "in_progress"}, …])
  → todo/write event: whole-list snapshot
  → UI renders the latest snapshot as a checklist
  → the next write replaces the whole list
```

* Every write is **the entire list**, not an incremental diff — replay only needs to fold in the latest snapshot
* `todo/write` is **log-only UI state**: whole-list snapshot, latest-write-wins on replay; **never enters derived history** (the model does not treat it as a message)
* The model maintains it through tool calls; the UI observes it through `session/event`

## Parallel Semantics

`allowParallelInProgress` is a **required config with no default**:

* Choosing `true` (the branch the tool catalog presents by default): the description allows multiple `in_progress` items at once — parallel work may mark several tasks as in progress
* A deployment choosing `false` gets the same tool, but the description requires exactly 1 active task

This is a typical example of "config as behavior": the same tool schema steers the model toward different discipline under the two configurations.

## Comparison with the Reference Implementation

Claude Code's task system is a **dual-track architecture**: in-memory V1 TodoWrite and filesystem V2 Tasks (with dependency management, claim races, and verification nudges). DeepSeek Harness chooses a **single minimal model**:

| Dimension | Claude Code Tasks | dsh todo_write |
|---|---|---|
| Storage | filesystem + in-memory dual track | session log events (`todo/write`) |
| Entries | id, dependencies, claims, verification | one line of content + three-state status |
| Updates | incremental | whole-list snapshot replacement |
| Replay | requires state reconstruction | folding the latest snapshot suffices |

Tradeoff: dsh gives up advanced features like dependency management and claim races in exchange for **stateless replay, zero drift, and natural alignment with event sourcing** — task state lives in the same log as the conversation history, and fork/resume/compaction carry it automatically.

## Tool Schema Highlights

| Tool | Behavior |
|---|---|
| `todo_write` | Replaces the whole todo list; `{ todos: TodoItem[] }` |

## Usage Patterns

The model follows a "plan → execute → update" loop across turns:

1. On receiving a request, first decompose the task with `todo_write`
2. Update each entry's status as it is completed
3. At the end of a turn, the list should be all `completed` or honestly mark what remains

The UI renders the latest `todo/write` event as a checklist — the user sees the agent's "in progress" state in real time, which is also the foundation for long tasks being interruptible and continuable.
