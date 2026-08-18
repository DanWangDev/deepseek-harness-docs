# 上下文压缩：记忆的整理术

> 深度解析 DeepSeek Harness 的上下文压缩（compaction）：`compaction/*` 会话事件如何加锁、摘要生成如何替换 surface 范围、压力压缩与手动压缩的区别，以及工具结果剪枝如何腾出空间。

## 为什么需要压缩

上下文窗口是有限的。一个长会话的日志不断增长，最终会超出模型的 context window。压缩（compaction）把一段历史**折叠为摘要**：日志不删（仅追加），但派生历史中的旧节点被一个摘要节点**替换**（surface `replace`）。

压缩是**一项可选能力**，不属于 agent loop 主干——Service Definition（`dsh-compaction`，`ctx.compaction`）、Service Provider（如 `dsh-compaction-basic` 后端）、Consumer（`dsh-command-compact` 人类命令）。

## `compaction/*` 会话事件

压缩通过声明合并为 `SessionEventMap` 扩展三种事件类型，三者都**仅写入日志**——它们记录锁、摘要、选中范围、被遮蔽事件 seq、token 数以及模型调用，**绝不进入 surface**：

| 事件 | 载荷 | 作用 |
|---|---|---|
| `compaction/start` | `{ turn }` | 获取日志记录的锁；数字标识尚未结束的自动轮次，`null` 标识独立手动尝试 |
| `compaction/summary` | `{ summary, rawOutput?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | 安全摘要投影、被遮蔽的 surface 边界对与 seq、估算 token 数、摘要调用的 envelope |
| `compaction/end` | `{ turn, error? }` | 释放锁（`error` 记录失败尝试） |

**锁括住整个操作**：先追加 `compaction/start`，然后执行摘要生成、写入 `compaction/summary` 与 `user/message` 替换，最后才追加 `compaction/end`。最后释放锁意味着操作中途崩溃会表现为可检测的遗留锁（有 start 而无匹配的 end），而非虚假声称完成的 end。

摘要本身承载在另一条带 `surfaceOp: { op: 'replace', start, end }` 的 `user/message` 上——**这是摘要压缩执行的唯一 surface 变更**：

```text
日志（仅追加，永不删除）
  … user/message(seq 40) … tool/result(seq 55) …
  compaction/start (seq 60, turn=7)
  compaction/summary (seq 61)
  user/message: 摘要 (seq 62, surfaceOp replace 40..55)
  compaction/end (seq 63, turn=7)

派生历史（surface）
  … [摘要替换了 40..55 的全部节点] …
```

## 触发方式

| 触发 | API | 语义 |
|---|---|---|
| 自动压力 | `compactIfNeeded(agent, trigger, signal)` | `trigger` 为 `'pressure'`（压力策略）或 `'context-overflow'`（规范化溢出，可低于普通阈值强制有界缩减） |
| 手动 | `compactNow(agent, signal)` | 作为轮次之间的 agent maintenance 运行；没有有效范围时返回 `null` 且不写入 |
| 区域 | `compactRegion(...)` | 针对显式、两端均包含的 surface 范围 |

压力压缩在串行 `agent/pre-step` 中运行，先于请求推导。失败请求的恢复通过 `agent/request-error` 运行：仅当 surface replacement generation 前进时才返回重试动作。

## 手动压缩的失败分类

```ts
/** Expected failure classes for an explicit idle-session compaction request. */
type ManualCompactionErrorCode =
  | 'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence'
```

`changed` 和 `summary` 保持会话 surface 不变，但仍闭合失败尝试并持久化到日志。`commit` 可能发生在部分变更之后；`persistence` 表示内存中的标记对已闭合但 flush 失败。

## 工具结果剪枝

可选的工具结果剪枝服务（`dsh-compaction-tool-result-pruner`）在压力压缩选择范围前运行：把大体积的 `tool/result` 内容替换为精简版，报告每次持久内容替换与 Unicode code point 的总减少量：

```ts
/** Aggregate outcome of one stable-surface pruning pass. */
interface PruneResult {
  readonly pruned: readonly PrunedEntry[]   // 每个条目：originalSeq → replacementSeq + 字符统计
  readonly charsRemoved: number
}
```

剪枝后再通过 `ctx.tokenMeter` 重新测量，并且**可以在不生成摘要的情况下推进 surface**。

## 区域边界：工具配对

区域边界**保持工具调用/结果配对，但不保持整个轮次**——因此一个过大轮次中较早关闭的步骤可以被压缩。`toolPairingBalancedBefore(session, seq)` 与 `toolPairingBalancedAfter(session, seq)` 检查 seq 之前/之后的配对；它们验证当前 surface 成员关系，拒绝缺失的 seq 与遗留结果。

## 与 token 预算的关系

压缩释放的空间由[Token 预算与请求头](../context/token-budget.md)中的 `ctx.tokenMeter` 度量：估算与回放由单例 token meter 直接拥有，而 `dsh-compaction-basic` 拥有保留策略、事件排序、按路由执行的摘要调用及其配置——**该 seam 不拥有计价 API**。
