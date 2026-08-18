# Context Compaction: Organizing Memory

> An in-depth look at DeepSeek Harness context compaction: how the `compaction/*` session events lock, how summary generation replaces a surface range, the difference between pressure and manual compaction, and how tool-result pruning frees space.

## Why Compaction Is Needed

The context window is finite. A long session's log keeps growing and eventually exceeds the model's context window. Compaction **folds a stretch of history into a summary**: the log is never deleted (append-only), but old nodes in the derived history are **replaced** by a single summary node (surface `replace`).

Compaction is an **optional capability**, not part of the agent loop spine—Service Definition (`dsh-compaction`, `ctx.compaction`), Service Provider (e.g. the `dsh-compaction-basic` backend), Consumer (the `dsh-command-compact` human command).

## The `compaction/*` Session Events

Compaction extends `SessionEventMap` with three event types via declaration merging, all of which are **log-only**—they record locks, summaries, the selected range, shadowed event seqs, token counts, and model calls, and **never enter the surface**:

| Event | Payload | Purpose |
|---|---|---|
| `compaction/start` | `{ turn }` | Acquires the logged lock; a number identifies an unfinished automatic turn, `null` an independent manual attempt |
| `compaction/summary` | `{ summary, rawOutput?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | The safe summary projection, the shadowed surface boundary pairs and seqs, the estimated token count, and the envelope of the summary call |
| `compaction/end` | `{ turn, error? }` | Releases the lock (`error` records a failed attempt) |

**The lock brackets the whole operation**: `compaction/start` is appended first, then summary generation runs and the `compaction/summary` and `user/message` replacement are written, and only then is `compaction/end` appended. Releasing the lock last means a crash mid-operation shows up as a detectable leftover lock (a start without a matching end), never as an end that falsely claims completion.

The summary itself rides on a separate `user/message` carrying `surfaceOp: { op: 'replace', start, end }`—**this is the only surface change summary compaction performs**:

```text
Log (append-only, never deleted)
  … user/message(seq 40) … tool/result(seq 55) …
  compaction/start (seq 60, turn=7)
  compaction/summary (seq 61)
  user/message: summary (seq 62, surfaceOp replace 40..55)
  compaction/end (seq 63, turn=7)

Derived history (surface)
  … [summary replaced all nodes 40..55] …
```

## Triggering

| Trigger | API | Semantics |
|---|---|---|
| Automatic pressure | `compactIfNeeded(agent, trigger, signal)` | `trigger` is `'pressure'` (the pressure policy) or `'context-overflow'` (normalized overflow, which can sit below the ordinary threshold to force bounded reduction) |
| Manual | `compactNow(agent, signal)` | Runs as agent maintenance between turns; returns `null` and writes nothing when no valid range exists |
| Region | `compactRegion(...)` | Targets an explicit surface range, inclusive at both ends |

Pressure compaction runs in the serial `agent/pre-step`, ahead of request derivation. Recovery from a failed request runs through `agent/request-error`: a retry action is returned only when the surface replacement generation advances.

## Failure Classification for Manual Compaction

```ts
/** Expected failure classes for an explicit idle-session compaction request. */
type ManualCompactionErrorCode =
  | 'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence'
```

`changed` and `summary` leave the session surface unchanged but still close the failed attempt and persist it to the log. `commit` can occur after a partial change; `persistence` means the in-memory marker pair was closed but the flush failed.

## Tool-Result Pruning

An optional tool-result pruning service (`dsh-compaction-tool-result-pruner`) runs before pressure compaction selects a range: it replaces bulky `tool/result` contents with trimmed versions and reports each persistent content replacement plus the total reduction in Unicode code points:

```ts
/** Aggregate outcome of one stable-surface pruning pass. */
interface PruneResult {
  readonly pruned: readonly PrunedEntry[]   // per entry: originalSeq → replacementSeq + char counts
  readonly charsRemoved: number
}
```

After pruning, the surface is re-measured through `ctx.tokenMeter`, and **it can advance without generating a summary**.

## Region Boundaries: Tool Pairing

Region boundaries **preserve tool call/result pairing but not whole turns**—so a step closed early inside an oversized turn can be compacted. `toolPairingBalancedBefore(session, seq)` and `toolPairingBalancedAfter(session, seq)` check the pairing before/after a seq; they validate membership in the current surface and reject missing seqs and orphaned results.

## Relationship to the Token Budget

The space compaction frees is measured by `ctx.tokenMeter`, described in [Token Budget and Request Headers](../context/token-budget.md): estimation and replay are owned directly by the singleton token meter, while `dsh-compaction-basic` owns the retention policy, event ordering, per-route summary calls, and their configuration—**the seam does not own the metering API**.
