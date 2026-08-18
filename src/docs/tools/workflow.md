# 工作流：脚本化多 Agent 编排

> 工作流 seam 允许 agent 运行**由模型编写、会启动 subagent 的编排脚本**（`workflow` 工具）：脚本是纯 JavaScript，在 worker 线程的 vm 上下文中执行，通过 `agent()`/`pipeline()`/`parallel()` 钩子扇出多个子 agent。

## 能力定位

与 subagent 一样，工作流是**一项可选能力**，不属于 agent loop。与 bash 一样，每个上下文只允许一个引擎实现提供 `ctx.workflowEngine`——没有命名提供方注册表，第二个引擎通过插件配置替换第一个。

| 角色 | 包 |
|---|---|
| Service Definition | `dsh-workflow`（`ctx.workflowEngine` + 词汇） |
| Service Provider | `dsh-workflow-worker-thread`（`node:worker_threads` 引擎——每个 run 一个 worker，脚本的 vm 上下文位于其中） |
| Consumer | `dsh-tool-workflow`（`workflow` 工具） |

## 启动请求

```ts
/** What a caller asks for when starting a workflow run. */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  signal?: AbortSignal
}
```

`meta` 与 `args` 是普通 JSON 数据；引擎用 schema 校验 `meta`，在任何工作开始前明确报错并拒绝无效数据——**引擎绝不会通过对脚本文本求值来获取它们**。`parent` 是必填字段——脚本启动的每个子 agent 都归属于它，cwd、谱系与深度通过 subagent seam 传递。

## 脚本钩子

脚本内可用四个编排原语（以及 `phase(title)` 进度声明与 `log(message)` 叙述）：

| 钩子 | 行为 |
|---|---|
| `agent(prompt, opts?)` | 运行一个子 agent 到完成；带 `opts.schema` 时校验并返回结构化对象；失败 resolve `null` |
| `pipeline(items, ...stages)` | 将每个 item 依次通过各阶段，阶段间**无屏障**；阶段抛错将该项置 `null` 并跳过其余阶段 |
| `parallel(thunks)` | 并发运行零参函数并等待全部（屏障）；抛错 resolve `null` |
| `phase(title)` / `log(message)` | 进度展示：`phase()` 调用与 `meta.phases` 标题匹配，供观察者使用；**不暗示任何执行结构** |

## 失败纪律：`WorkflowError.fatal`

脚本内部的钩子误用——错误参数、未知或延迟的 `agent()` 选项、超出结构化输出子集的 schema、超出上限、seam 启动失败、取消——都抛出 `fatal: true` 的 `WorkflowError`：

* `parallel()`/`pipeline()` 组合器对 fatal 错误**直接重新抛出**，而非将该项映射为 `null`
* 一个拼写错误的选项必须明确报错并终止脚本，绝不能消融为看似普通子 agent 失败的结果
* 逐项的 `null` 保留给子运行失败（非 `completed` 的 stop reason）和阶段内的普通脚本错误

## 活跃运行与终态

```ts
/** Holder-owned live workflow. result never rejects; consumers may cancel and must call dispose(). */
interface WorkflowRun {
  readonly id: WorkflowRunId
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  cancel(reason?: string): void
  dispose(): Promise<void>
}
```

* `result` 不会被拒绝：脚本失败兑现为 `stopReason: 'error'`
* 运行被取消后，结果在引擎规定的**有界宽限期**内结算为 `cancelled`，随后 worker-thread 引擎终止脚本所在的 worker——等待 `result` 的消费方不会无限期挂起
* `dispose()` 执行取消、等待有界结算并等待子 agent 完全停稳

```ts
interface WorkflowResult {
  value: unknown          // 脚本的物化返回值（宿主 JSON；无返回为 null）
  stopReason: WorkflowStopReason  // 'completed' | 'cancelled' | 'error'
  error?: string
  agentsStarted: number   // 全程接受的 agent() 调用数
}
```

## 事件与持久记录

`workflow/*` 事件（`workflow/start`、`workflow/phase`、`workflow/log`、`workflow/agent-start`、`workflow/agent-end`、`workflow/end`）是**仅供观察**的 emit：payload 以 `WorkflowRunInfo`（id + meta）开头而非活跃 run，因此订阅者无法获得 `cancel`/`dispose`；`workflow/end` 刻意省略 result value。每次 emit 对每个监听器隔离——订阅者抛出的异常被记录而不会传播。

顶层消费方把展示事实投影到调用它的父 Session：运行接受后写 `tool-workflow/run-start`，结果取得且 dispose 完全停稳后写 `tool-workflow/run-end`（以 `runId + seq` 配对成员）。`dsh-tool-workflow/invariant` 校验同一协议：每个运行只有一个 start，成员 end 必须配对，运行结束后不能继续更新。

## 典型使用

```js
// 模型写给 workflow 工具的脚本（示意）
const files = await agent({ label: 'list-packages', prompt: '枚举仓库中的所有包' }, {
  schema: { type: 'object', properties: { pkgs: { type: 'array', items: { type: 'string' } } }, required: ['pkgs'] },
})
phase('audit')
const results = await parallel(files.pkgs.map(pkg => () =>
  agent({ label: pkg, prompt: `审计 ${pkg} 的依赖` })))
return { results }
```

工作流是"把扇出写成代码"的能力：一次调用，多个子 agent 并行/流水执行，结果结构化返回——这是多 Agent 编排的规模化路径。Ralph 循环是它的特化（面向不可变目标的前台全新 agent 工作流），`ralph` 工具在每个 Round 启动一个全新的结构化子级。
