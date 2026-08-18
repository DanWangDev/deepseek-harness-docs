# 任务管理：todo_write 快照

> 揭秘 DeepSeek Harness 的任务管理系统：`todo_write` 工具如何通过全量列表快照维护 agent 的待办清单——一个有意保持精简、可在 UI 中渲染为检查清单的会话状态。

## 为什么需要任务管理

一个长任务可能横跨多个轮次：修复测试、重构模块、写文档。模型需要"当前进行到哪了、接下来做什么"的记忆——不是藏在 prompt 里的自由文本，而是**结构化的、可在 UI 渲染、可被模型读取**的状态。

`todo_write` 就是这个机制：一个会话所有的状态，UI 将最新的 `todo/write` 事件渲染为检查清单。

## 数据模型：有意的精简

```ts
/** One entry in an agent's todo list — the unit of the `todo/write` event's whole-list snapshot. */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

注意**刻意省略了什么**：没有 id、没有优先级、没有 `activeForm`——因为列表在每次写入时**整体替换**（last-write-wins），条目无需稳定标识。三个状态描述完整的可移植生命周期。

## 全量快照语义

```text
模型: todo_write([{content: "修复测试", status: "in_progress"}, …])
  → todo/write 事件：全量列表快照
  → UI 渲染最新快照为检查清单
  → 下次写入整体替换
```

* 每次写入都是**整个列表**，不是增量 diff——回放只需折叠最新快照
* `todo/write` 是**仅日志的 UI 状态**：whole-list snapshot，latest-write-wins on replay；**绝不进入派生历史**（模型不把它当作消息）
* 模型通过工具调用维护它，UI 通过 `session/event` 观察

## 并行语义

`allowParallelInProgress` 是**没有默认值的必填配置**：

* 选择 `true`（工具目录默认展示的分支）：描述允许同时存在多个 `in_progress` 项——并行工作可以标记多个任务进行中
* 选择 `false` 的部署获得同一工具，但描述会要求只能有 1 个活动任务

这是"配置即行为"的典型例子：同一个工具 schema 在两种配置下引导模型采用不同的纪律。

## 与参考实现的对比

Claude Code 的任务系统是**双轨架构**：V1 内存 TodoWrite 与 V2 文件系统 Tasks（包含依赖管理、认领竞争和验证推动）。DeepSeek Harness 选择**单一精简模型**：

| 维度 | Claude Code Tasks | dsh todo_write |
|---|---|---|
| 存储 | 文件系统 + 内存双轨 | 会话日志事件（`todo/write`） |
| 条目 | id、依赖、认领、验证 | 一行 content + 三态 status |
| 更新 | 增量 | 全量快照替换 |
| 回放 | 需要状态重建 | 折叠最新快照即可 |

取舍：dsh 放弃了依赖管理、认领竞争等高级特性，换来**无状态回放、零漂移、与事件溯源天然一致**——任务状态与对话历史存储在同一份日志里，fork/恢复/压缩自动携带。

## 工具 schema 要点

| 工具 | 行为 |
|---|---|
| `todo_write` | 整体替换待办列表；`{ todos: TodoItem[] }` |

## 使用模式

模型在轮次中遵循"计划 → 执行 → 更新"的循环：

1. 收到需求后先 `todo_write` 拆解任务
2. 每完成一项更新对应条目的 status
3. 轮次结束时列表应全部 `completed` 或如实标注剩余

UI 把最新的 `todo/write` 事件渲染为检查清单——用户实时看到 agent 的"进行中"状态，这也是长任务可中断、可继续的基础。
