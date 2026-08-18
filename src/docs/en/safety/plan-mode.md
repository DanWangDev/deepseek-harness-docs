# Plan Mode: Look Before You Leap

> A source-based analysis of DeepSeek Harness's Plan Mode: the `plan:policy` prompt section, the `exit_plan_mode` tool, the `/plan` command, and pre-step appending of logged state — as well as its boundary with the enforced sandbox/approval restrictions as **soft guidance**.

## What Plan Mode Is

Plan mode is **log-recorded, per-agent collaborative state** owned by `dsh-plan-mode` (`ctx.planMode`, `PlanModeController`): while active, every model request includes a section of deployment-held guidance.

```yaml
# Configuration (PlanModeConfig)
plan-mode:
  config:
    section: |
      You are in plan mode. Do not modify files. Research and present a plan
      using the exit_plan_mode tool, starting with a `#` heading.
```

A missing, blank, or non-string `section`, as well as any unknown key, fails at plugin load. While plan mode is active, the exact `section` text renders as the `plan:policy` system-prompt section at order 50; when inactive it **contributes no text at all**.

## Soft Guidance, Not Enforced Restriction

Plan mode is **soft guidance** — it steers the model through the prompt rather than enforcing:

| Mechanism | Type | Enforced? |
|---|---|---|
| `plan:policy` section | prompt | no (soft guidance) |
| sandbox mode | `SandboxMode` | yes |
| approval policy | `ApprovalPolicy` | yes |

**Neither** the sandbox mode **nor** the approval policy **reads or writes plan state** — deployments must configure them separately (wanting "read-only, no writes" in plan mode requires configuring both `sandbox: read-only` and the approval policy).

## Logged State and Resume

`plan/mode` (`{ active: boolean }`) is a log-only, whole-value-replacement session event: durable and replayable, **never entering the model transcript**.

```ts
foldPlanMode(events, end?)  // returns the last recorded value in the prefix; false when there is none
```

The effective state is always a pure fold of the session log — resume, forks, and compaction can restore it without a live mirror; the UI observes committed switches via `session/event`.

## Pending Selections and Pre-Step Appending

```ts
get(agent: Agent): { active: boolean; pending?: boolean }
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

Because every session event sits within a turn, a user selection stays **pending** until the next accepted in-turn pre-step appends it before deriving the request:

* While the agent runs, the only append point is the front-registered `agent/pre-step` listener — it observes each candidate request step, calls the downstream listener first, and appends only after the downstream accepts the step
* Between turns the selection appends immediately (`committed`); within a turn it stays pending (`queued`)
* Appending a user selection also records a plugin-sourced `user/message` notification — only when the last recorded request header describes a different state (the model is notified exactly when the context changes, never repeatedly)

## The Exit Tool and the `/plan` Command

### `exit_plan_mode`

* **Stays registered** while plan mode is inactive — entering/leaving plan mode only changes the prompt section, never the request's tool catalog (the schema is stable)
* Executing outside plan mode fails
* In plan mode: requires a complete markdown plan starting with a `#` heading, submitted for review through the **user-interaction seam** (`ctx.userQuestions`)
* Approved → `{ approved: true }` plus a silent (non-narrated) pending exit, appended by the next accepted in-turn pre-step — the plan guidance stays in effect for the rest of the assistant's current batch of tool calls
* "Keep planning" → a failing call carrying user feedback, which the model uses to revise and resubmit
* A missing interaction channel or a service reload during review → the call fails, **never silently leaving plan mode**

### The `/plan` Command

When `ctx.commands` is composed, the plugin registers `/plan [off|message]`:

* Bare `/plan` → selects plan mode
* Any other non-empty message → selects plan mode first, then submits the text via `agent.steer()`, making it an ordinary logged user message for the next step under the plan guidance
* The exact argument `off` → selects inactive (and cancels the pending entry before it is appended and becomes visible to the request)

## Lifecycle Sketch

```text
User: /plan
  → plan/mode { active: true } (between turns → committed)
  → next pre-step appends → the plan:policy section enters the request
Model: [read-only research] … exit_plan_mode(plan)
  → userQuestions review
  → approved → pending exit
  → next pre-step appends plan/mode { active: false } → normal guidance resumes
```

## Comparison with the Reference Implementation

Claude Code's Plan Mode switches a permission context via `EnterPlanModeTool`/`ExitPlanModeV2Tool` (`prepareContextForPlanMode()` read-only mode, restored on exit), with separate plan-file persistence and an approval flow. DeepSeek Harness's version is simpler: **plan state is a log fold, the guidance is a prompt section, and exiting is a tool call with review** — there is no separate permission-context switch; permissions are each governed by the sandbox/approval policies (which is exactly what the "soft guidance" design means).
