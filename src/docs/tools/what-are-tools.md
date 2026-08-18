# 工具系统设计：AI 的双手

> 深入理解 DeepSeek Harness 的工具抽象：从 `ToolDefinition` 类型、`defineTool` DSL、注册机制、带守卫的执行流水线到渲染系统——工具如何通过统一的接口成为 agent 的能力。

## 一个工具是什么

一个已注册工具（`ToolDefinition`）由四部分组成：

| 部分 | 内容 |
|---|---|
| **面向模型的 schema** | `ToolSchema`：`name`、`description`、`parameters`（JSON Schema） |
| **规范输出声明** | `output`：原始 JSON Schema + 纯投影函数（`render` + 可选 `presentationMeta`） |
| **执行函数** | `execute(args, exec)`：返回规范的无损 JSON 值 |
| **展示与调度元数据** | `finalizeContent`、`timeoutMs`、`isConcurrencySafe`、`presentCall`、`presentResult` |

```ts
/** A registered tool: its schema plus the execution function. */
interface ToolDefinition extends ToolSchema {
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  /** Run one accepted call and return only its canonical lossless-JSON value. */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /** Synchronous last-mile transform for model-facing content. */
  finalizeContent?(exec, result): ContentBlock[] | undefined
  /** Cooperative tool-call timeout budget in milliseconds. */
  timeoutMs?: number
  /** Pure synchronous classifier for overlap with sibling tool calls. */
  isConcurrencySafe?(args: unknown): boolean
  /** How to present the PENDING state of one call in a UI. */
  presentCall?(args: unknown): ToolCallView | undefined
  /** How to present the COMPLETED state. */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

**执行与展示回调绝不泄漏到模型请求**：`schemas()` 只投影 `name`/`description`/`parameters`。

## `defineTool`：类型化 schema DSL

第一方工具不需要手写校验——`defineTool({ name, description, parameters, output, execute, … })`：

* 从 `ParameterSchemaSpec` 推导参数类型并绑定 `validateArgs()`
* 从 `OutputSchema` 推导函数体返回类型
* 参数不匹配抛 `ToolArgsError`（`INVALID_ARGS`）；输出无效抛 `ToolOutputError`（`INVALID_TOOL_OUTPUT`）

值 schema 词汇（`ValueSchemaSpec`）支持 `string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、仅作者侧可用的 `json`，以及要求恰好命中一个分支的 `oneOf`。精确推导保持到 16 层容器，之后放宽为 `JsonValue`——避免耗尽 TypeScript 的类型实例化栈。

## 执行流水线：带守卫的瀑布

`ctx.tools.execute()` 让一次调用依次经过七个阶段：

```text
tools/pre-execute (waterfall)   → allow | deny | ask
ToolGuard（单调）               → reason = deny；undefined = 放行
tools/execute (waterfall)       → 环绕分派：超时、重试、指标
tools/post-execute (waterfall)  → accept | replace | block
finalizeContent（定义自有）     → 恰好一次的最后内容变换
tools/result (emit)             → 冻结的最终结果
```

```ts
/** Pre-dispatch decision. `allow` runs the call; `deny` materializes an error; `ask` runs only after an approval service returns `allowed-once`. */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

关键不变量：

* **Guard 是单调的**：`ToolGuard` 返回类型有意不包含 allow 结果——`undefined` 保留 waterfall 的决策，返回的 reason 只能缩减权限，因此后续监听器无法撤销它
* **参数不可改写**：历史、审计、UI 和执行必须保持一致
* **`ask` 失败即拒绝**：未授权、缺少审批通道或服务、或无 agent 的请求都会变为拒绝；只有 `allowed-once` 才继续执行
* **失败不终止轮次**：未知工具和抛异常的工具都变为结构化错误（`ToolNotFoundError` → `UNKNOWN_TOOL`），调用失败但循环继续

## 执行调度：并行与独占

```ts
/** Scheduling mode for one pending call. `parallel` may overlap with siblings; `exclusive` runs alone and forms an ordering barrier. */
type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }
```

agent loop 向注册表查询每个待处理调用的执行模式，据此形成独占屏障和滚动池并行执行。只有 `isConcurrencySafe(args)` 精确返回 `true` 才可并行；未知、隐藏、未声明、无效或抛异常的分类器都是**独占**（fail-closed）。并行执行的函数体不得修改父级拥有的状态。

## 结果：执行期值与持久投影分离

工具返回的规范 `value` 仅存在于执行期间：循环只持久化 `content`、`error` 和 `meta`。注册表会在 `tools/result` 之前物化持久展示字段，因此**最终实时观察者能看到精确的执行期值，以及可安全用于后续持久追加的字段**。回放可以重现展示，却无法重建规范的中间值。

## 渲染意图：card 词汇

工具希望其调用在 UI 中如何呈现，**提供方无关**——`presentCall`/`presentResult` 返回 `card` 标签的渲染意图，UI 桥接层据此分发：

| 卡片 | 用途 |
|---|---|
| `generic` | 默认卡片（标题 + 原始参数） |
| `terminal` | shell 命令 → 终端卡片（输出 + 退出状态） |
| `diff` | 文件创建/修改 → 行内 diff 卡片 |
| `search` | 完成的发现型搜索（grep 按文件分组匹配 / glob 扁平路径列表） |
| `read` | 完成的文件读取（带行号、可选语法高亮） |
| `web` | 完成的 web 检索（结构化 `sources`/`answer`，或 `url`/`statusCode`） |

`ToolCallKind`（`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`）为通用卡片选择图标。host/client 运行时把这套中性词汇投影为各自的视图。

## 工具目录一览

| 工具族 | 模型可见名称 | seam |
|---|---|---|
| 文件系统 | `read`、`write`、`edit`、`read_image`、`glob`、`grep` | `ctx.fs` + `ctx.subprocess` |
| 命令执行 | `bash`、`pwsh` | `ctx.shell` + `ctx.jobs` |
| Web 访问 | `web_search`、`web_fetch` | `ctx.web` |
| 任务管理 | `todo_write` | 会话所有状态 |
| 委派 | `subagent`、`subagent_fork`、`send_message`、`interrupt_agent`、`list_agents`、`report` | `ctx.subagents` |
| 编排 | `workflow`、`ralph` | `ctx.workflowEngine` |
| 技能 | `skill` | `ctx.skills` |
| 其他 | `ask_user_question`、`exit_plan_mode`、`job_*`、`terminal_*`、`session_*`、`create_goal`/`get_goal`/`update_goal`、`lsp`、`schedule_*` | 各自 seam |

后续页面逐一拆解这些工具族的实现。
