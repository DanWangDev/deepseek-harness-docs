# 身份与遥测：匿名与审计

> DeepSeek Harness 的匿名身份与遥测机制：每 harness home 一个的随机 UUID、ledger/ops 双通道遥测、共享披露状态——以及"哪些数据会离开你的机器"的完整答案。

## 匿名身份

`@deepseek-ai/dsh-anonymous-user-id`（`packages/identity/anonymous-user-id`）是一个**共享库，不是 Cordis 插件**：

```ts
getOrCreateAnonymousUserId()  // 返回随机 UUID v4，每 harness home 一个
```

* 持久为 `$DSH_HOME/.anonymous-user-id` 单行（默认 `~/.dsh/`）
* **绝不从 hostname、网络或 git 派生**——它就是一枚随机 UUID
* 删除文件即重置；不同 home 不可关联
* 首次写入用独占创建，并发输者采纳持久者

它的消费方：

| 消费方 | 用途 |
|---|---|
| OTel 遥测后端 | 作为 Resource `user.id` 上报 |
| `/feedback` 确认 | 确认文本含同值 |
| `dsh-llm-deepseek` | 发 `x-deepseek-harness-user-id` 头 |

## 遥测 seam

遥测是**可选能力**：Service Definition + 捕获协调器 `ctx.sessionTelemetry`（`packages/session/session-telemetry`）；部署方加载 Provider `dsh-session-telemetry-otel`（原样配置的 OpenTelemetry JS SDK 日志流水线）。harness 职责止于 `emit()`——批处理、重试、排队归上报 SDK。

**内容不进入模型请求**——遥测只观察，不参与对话。

### 记录形状

```ts
SessionTelemetryRecord {
  channel: 'ledger' | 'ops'
  time: number
  severity: 'info' | 'warn' | 'error'
  attributes: Record<string, unknown>
  body?: unknown
}
```

| 通道 | 内容 |
|---|---|
| `ledger` | **一对一镜像** session-log 事件：attributes 只带 `session.id`/`event.type`/`event.seq`（及 header 有的 `session.cwd`/`parent_id`/`seed_length`） |
| `ops` | 运维事件：`agent-error`、`shutdown`（刻意无 `event.seq`，不被误认 ledger 行） |

细节纪律：

* 每个 `(turn, step)` 只发第一条 `assistant/chunk`（流已开始信号），其余分片丢弃——传输中 `seq` 缺口是常态
* ledger 按 `(session.id, event.seq)` 去重，ops 容忍重复
* 投递尽力而为；脱敏 waterfall 是 `session-telemetry/record`

### 共享披露

```ts
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

经 `ctx.sessionTelemetry.sharing` 必需成员披露：

| 状态 | 含义 |
|---|---|
| `full` | 遥测导出开启 |
| `feedback-only` | 仅 feedback 直接确认（不经遥测管道） |
| `disabled` | 完全关闭 |

`DSH_TELEMETRY_DISABLED` 只停 telemetry 导出——**不影响** feedback 直接确认与 DeepSeek provider 头（那枚 `x-deepseek-harness-user-id` 是身份，不是遥测）。

## 反馈（Feedback）

`@deepseek-ai/dsh-message-feedback` 是单条 assistant 消息的可编辑反馈——**本地 storage-domain sidecar**，刻意与不可变 Session 级 `feedback/record` 事件分离（非日志内容/投影、不做遥测交接）：

```ts
type MessageFeedbackRating = 'positive' | 'negative'
MessageFeedbackItem { messageId, rating, note?, version, createdAt, updatedAt }
```

`version` 是 CAS token——并发编辑以版本冲突拒绝。

## 审计全景

身份与遥测回答两个问题：**"你是谁"**（匿名 UUID，不可反向关联）与 **"发生了什么"**（ledger 镜像 + 会话日志）。结合会话日志的审计事件对（`approval/asked` + `approval/decided`、`hook/invoked` + `hook/result`），系统对外部观察者呈现的是：

```text
可回放的会话日志（模型可见即已记录）
  + 匿名身份（无法关联真实用户）
  + 可禁用的遥测（默认状态可披露）
  + 本地 feedback sidecar（不上报）
```

这就是"源码可审计"的完整含义——与那些内置遥测、无法关闭的 agent 产品形成对照。
