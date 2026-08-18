# 后台任务：长时运行管理

> 长时间运行的生产方、`ctx.jobs` 运行时与任务控制工具共用的词汇：bash 后台命令、PTY 发送与 subagent 如何通过同一套 `job_*` 工具读取、列出和终止。

## 为什么需要后台任务

agent 常常需要启动"跑很久"的工作：`pnpm run test`（几分钟）、长构建、后台轮询。如果每个工具调用都阻塞等待完成，agent 会被卡住——而且一旦模型输出被截断或轮次结束，前台工作可能被一起带走。

后台任务运行时（`ctx.jobs`）把"长时工作"从工具调用中**解耦**出来：

```text
bash("pnpm run test", run_in_background: true)
  → ctx.jobs.start({ kind: 'bash', label: 'pnpm run test', owner: agent })
  → 立即返回 JobId（bash-N）
  → 模型可以继续做别的事
  → job_output 读取输出 / job_list 列出 / job_kill 终止
  → 完成通知经 agent.inject() 作为 user/message 送达
```

## 生产方约定

```ts
/** Producer declaration passed to JobRegistry.start. */
interface JobStart {
  kind: JobKind              // 也是 id 前缀（bash、subagent、…）
  label: string              // 一行模型可见标签
  outputLimitBytes?: number  // 每条完整完成通知/输出读取的 UTF-8 字节上限
  owner?: Agent              // 拥有者 agent；其 dispose 会取消并等待该 job
  run(): JobHooks            // 预检后调用；抛错则什么都不注册
}
```

```ts
/** Hooks through which the runtime controls and observes producer work. */
interface JobHooks {
  cancel(reason?: string): void        // 同步、幂等、最终结算 done
  done: Promise<JobOutcome>            // 生产方释放资源后 resolve（不是工作完成时）
  readOutput?(): string                // 消费上一次调用以来的输出
}
```

访问控制依赖**拥有者授权**（`ownerSession` 携带共享 `SessionId`），而非 id 的保密性。

## 状态与快照

```ts
type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
```

`JobSnapshot` 是每次新建的**只读投影**（新对象，绝非实时注册表状态）。`JobOutcome.status` 是生产方报告的三态终局：`completed`（完成）、`killed`（取消）、`failed`（失败），附 kind 专属的 `detail`（如 `'exit code: 3'`、`'max-tokens'`）。

## 工具三件套

| 工具 | 行为 |
|---|---|
| `job_list` | 列出任务（kind、label、状态快照） |
| `job_output` | 读取自上次读取以来的输出（流式任务）；等待任务时阻塞 |
| `job_kill` | 请求取消（同步、幂等，最终结算） |

`dsh-tool-jobs` 与任务种类无关：**bash 后台命令、PTY 发送和 subagent 都通过相同的 3 个工具读取、列出和终止**。加载该插件会挂接控制器，从而启用生产方的 `ctx.jobs.start()`。

## 完成通知

完成监听器把 `JobOutcome` 渲染为模型可见的完成通知（经 `agent.inject()` 作为 user/message 注入）：

* `outputLimitBytes` 是每个完整通知的字节上限——`'exit code: 3'` 这样的状态行不会吞掉输出预算
* `reported` 字段抑制完成通知：另一个接口已经交付终止状态或承诺交付时（如 subagent 结果的自动投递），不会重复通知
* 排空 owner 或服务的 teardown 取消同样计入

## 与工具族的联动

| 生产方 | 通过 | 后台化 |
|---|---|---|
| bash/pwsh 工具 | `run_in_background: true` 参数 | 注册 `ctx.jobs`；`enableRunInBackground` 可移除该参数 |
| terminal_send | `run_in_background: true` | 注册 `ctx.jobs` |
| subagent | 后台模式（`continuable` 默认） | 经 `ctx.subagents` 的 activation 管理，结果经 `subagent` 工具自动投递 |

## 示例流程

```text
模型: bash("pnpm run test", run_in_background: true)
  → tool/result: { jobId: "bash-3" }
模型: todo_write([...])   ← 继续做别的事
  ← user/message: "Background job bash-3 completed: exit code 0"
模型: job_output({ job_id: "bash-3" })  → 完整输出
```
