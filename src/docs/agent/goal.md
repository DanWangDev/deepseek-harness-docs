# 同会话目标：持久完成目标

> 目标（goal）是附着在现有会话上的单个持久完成目标：`create_goal`/`get_goal`/`update_goal` 工具 + `/goal` 人类命令，按修订号演进的 `active`/`paused`/`blocked`/`complete` 阶段，以及 Goal Round 续行机制。

## 目标是什么

一个**目标**附着在现有会话上，而不是一段独立对话：

* 它是一份**持久状态**（`goal/change` 会话事件），不是调度器，也不是调度队列
* 会话日志仍是其真源——fork、恢复、压缩自动携带目标
* 它的工作通过**续行**进行：同会话驱动器把 Goal Round 具体化为一个由目标触发的轮次

```ts
/** Durable continuation phase. Activation is process-local and separate. */
type GoalPhase =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'complete'
```

## 数据模型

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
  readonly blockedReason?: GoalBlockReason   // 仅 phase === 'blocked' 时存在
  readonly maxGoalRounds: number
}
```

* `GoalId` 是品牌化 id；每次获准的持久变更都递增修订号——工具按 `{ id, revision }` 做 compare-and-set
* **`blocked` 是唯一表示"因问题而停止"的持久状态**：携带稳定 lower-kebab-case 代码 + 人/模型可读说明
* `GoalView` 额外投影 `roundsStarted`、`createdAt`、`updatedAt` 与进程本地的 `activation`（`armed`/`disarmed`）

## Goal Round 与激活

* **Goal Round**：为当前目标接纳的一次续行周期。同会话驱动器把 Goal Round 具体化为一个由目标触发的轮次，其中可包含零个或多个步骤；**同一会话中无关的人类轮次不消耗 Goal Round 上限**
* **激活**：续行消费方接纳下一个 Goal Round 的进程本地权限（`armed`/`disarmed`）。它有意不参与持久回放——**恢复或 fork 后，只有随后通过 `/goal` 或模型工具执行一次经人类授权的恢复变更，自动工作才能开始**（disarmed 是安全默认）

## 工具与命令

| 工具 | 行为 |
|---|---|
| `create_goal` | 创建目标（需要直接来自人类的根权限） |
| `get_goal` | 读取当前目标（含精确 id/revision、阶段、已完成的续行轮数、round 上限） |
| `update_goal` | 修改目标：`edit`/`pause`/`resume` 要求人类根权限；`complete`/`blocked` 接受确切的当前 Goal Round；`blocked` 默认下限是 3 个获准的 Round |

`/goal` 是 `dsh-command-goal` 提供的人类命令——直接观察或更改当前目标，输出属于 UI 状态；目标领域拥有每条持久且模型可见的记录。

## 持久变更

每次变更都是持久的 `goal/change` 会话事件，其载荷要么是变更后的完整快照，要么是清除墓碑。严格折叠与持久投影只从这些事件派生生命周期状态——**inbox 变更不会影响 goal 状态**。

```text
create_goal("修复 CI")        → goal/change { phase: 'active', revision: 1 }
[Goal Round 1: 轮次 → 步骤 → 工具]
update_goal(revision=3, pause) → goal/change { phase: 'paused', revision: 4 }
resume                        → goal/change { phase: 'active', revision: 5 }
complete                      → goal/change { phase: 'complete', revision: 6 }
```

## 与任务管理的关系

`todo_write` 是会话内的**执行清单**（全量快照、UI 检查清单）；goal 是会话级的**完成契约**（持久阶段、round 预算、blocked 原因）。前者回答"进行到哪"，后者回答"为什么继续、还能继续多久"——两者都存储为会话事件，都从日志回放。
