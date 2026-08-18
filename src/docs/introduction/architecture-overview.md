# 架构全景：插件化分层详解

> 从组合层到基础设施层，详解 DeepSeek Harness 的插件化架构设计。基于 `packages/` 的源码级数据流分析——运行中的 dsh 是一棵插件树，由启动时按序叠加的各层组合而成。

## 一个核心事实：一切皆插件

DeepSeek Harness 建立在 [Cordis](../core/cordis.md) 之上：插件向共享上下文贡献服务、类型化事件和可逆的副作用。**产品的每一部分都是插件**，包括模型适配器、工具注册表、会话日志，以及 agent loop 本身。因此每一部分都可以从配置替换——不存在需要打补丁的特权内核。

## 组合层：Profile 与组合包

运行中的 `dsh` 是一棵插件树，由启动时按序叠加的各层组合而成：

```text
空条目列表
  ├── profile 列出的每个组合包（按顺序）
  ├── profile 的 cordis.patch.yml
  ├── home 级的 cordis.patch.yml
  └── 任意 --patch overlay（优先级最高）
```

* **profile**：存放在 Harness home 中的具名组装。它列出自己叠放的组合包，存放自己安装的树外插件，并保存用户自己的 `cordis.patch.yml`。`web` 和 `headless` 作为模板随发行版交付。
* **组合包（bundle）**：Cordis 配置项及其挂载代码的分发格式——它插入的内容始终可被其上各层 patch。一条 patch 按 id 定位某个条目并替换其整个 config，或插入新条目。

| 组合包 | 内容 |
|---|---|
| `dsh-base` | 每个 profile 的第一层：模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测 |
| `dsh-web-app` | 浏览器应用（Web UI） |
| `dsh-headless` | 一次性运行器，完全不带服务器 |

要查看你的机器实际启动的配置树：

```sh
dsh --profile web --dump-config
```

它打印出的任何条目，都可以由你自己的 patch 替换。

## 核心包：六个主干包

一个轮次按同一条循环流经六个包，每个包向 Cordis 树贡献一个 `ctx.<key>` 服务：

| 包 | 职责 | `ctx` 键 |
|---|---|---|
| `core/session` | 仅追加的 `SessionEvent` 日志与内存 store——唯一真源 | `ctx.sessions` |
| `core/system-prompt` | 提示词片段与工具 schema 的组装 | `ctx.systemPrompt` |
| `core/tools` | 作用域化的工具注册表和带把关的执行流水线 | `ctx.tools` |
| `core/agent` | `Agent` 接口、活跃 agent 注册表和 `agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | 实现公开 `Agent` 约定的默认驱动器 | `ctx.agentLoop` |
| `core/scope` | 按 agent 划分作用域的注册原语 | 库，无 ctx 键 |

`agent-loop` 是公开 `Agent` 约定的唯一具体实现，但扩展插件只依赖 `agent`（包括需要发起 Agent 时），绝不直接依赖 `agent-loop`——**循环保持可替换**。把这条主干接成可运行 agent 的默认组合是 `examples/agent-spine-demo`。

## 轮次流程：一条主数据流的源码追踪

一个**步骤**是一次模型请求加上它调用的工具。一个**轮次**包含零个或多个步骤：它在领取首条输入之前打开，并在不再欠下任何工作时关闭：

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`、`step/*`、`user/message`、`assistant/*` 和 `tool/*` 是**持久会话事件**；其余是分属三个事件域的实时扩展点。`agent/pre-step`、`agent/request`、`llm/stream` 和三个 `tools/*` 事件是 waterfall（瀑布式事件），其监听器必须调用 `next()` 才能委托下去；`agent/turn-stopping` 是 serial 事件，没有 `next()`。

## 事件：三个事件域

事件就是扩展点，而选对事件域是大多数改动的第一个决定：

| 事件域 | 载体 | 何时使用 |
|---|---|---|
| **会话事件** | 追加到日志并通过 `session/event` 广播的持久事实 | 当某个事实必须在重新加载后仍然存在时 |
| **Agent 事件**（`agent/*`） | 携带活跃 `Agent`：inbox、步骤、状态、请求、验证、续跑 | 观察或拦截进行中的工作时 |
| **能力事件** | 无需导入循环即可向某个 seam（`fs/*`、`tools/*`、`telemetry/*`）附加策略和适配器 | 向能力附加策略时 |

**模型可见即已记录。** 抵达模型请求的一切都必须能从日志重建，并由一项运行时不变量断言这一点。因此，新增一项模型可见输入就需要新增一个会话事件。

## 能力 seam：可替换能力的三种角色

一个 **seam** 是一项可替换能力，包含三种角色：

| 角色 | 职责 | 示例（shell） |
|---|---|---|
| **Service Definition** | 声明接口（拥有自身 `ctx.<key>` 的 Cordis `Service`） | `dsh-shell` |
| **Service Provider** | 实现接口 | `dsh-bash-local` / `dsh-bash-sandbox` |
| **Consumer** | 使用服务（通常是面向模型的工具） | `dsh-tool-bash` |

一个包可以合并承担多个角色（`dsh-llm` 同时是 Service Definition 和 Consumer），但单一角色本身不是 seam；**添加一项能力意味着把三者一并设计**。

seam 正是替换一个提供方就能改变整个产品的原因：文件系统与进程提供方共享同一个执行世界，因此把它们指向远程沙箱，也就把 Bash、PTY 和 LSP 一并搬了过去，无需提供方专用 fork。subagent 提供方在同一个接口之后同样千差万别——从新建一个子 agent，到把一个轮次委派给另一个产品。

## 新行为的归属位置

| 目标 | 机制 |
|---|---|
| 添加模型提供方 | 在 `ctx.llm` 上注册其适配器 |
| 添加面向模型的能力 | 在 `ctx.tools` 上注册；其 schema 加入提示词组装 |
| 让某个会话拥有不同的能力集合 | 组装一个 agent preset；其中的服务行需要 `isolate` realm |
| 添加 shell 执行 | 注册 `ctx.shell` 后端；本地后端通过 `ctx.subprocess` spawn 进程 |
| 添加持久化终端执行 | 注册 `ctx.terminals` 后端和 `dsh-tool-terminal` |
| 添加用户命令 | 在 `ctx.commands` 上注册；它无需模型轮次即可分派 |
| 添加后台工作 | 在 `ctx.jobs` 上注册；`job_*` 工具负责收集或停止 |
| 添加文件系统访问或策略 | 注册 `ctx.fs` 提供方，或监听 `fs/*` 事件 |
| 限制所启动的进程 | 使用 `ctx.sandbox` 后端；消费方在启动进程前包装 argv |
| 拦截请求、工具或轮次 | 使用相应的 `agent/*` 或 `tools/*` 事件 |
| 添加模型可见上下文 | 调用 `agent.inject()`；它会落到下一次获准的请求中 |
| 添加 UI 或编辑器集成 | 驱动 `ctx.agents` 并从 `session/event` 渲染 |
| 生成会话标题 | 注册唯一的 `ctx.sessionTitle` 提供方 |
| fork 活跃会话 | `ctx.sessions.fork(source, boundary?, childSessionId?)` |

## 四个核心设计原则

### 插件即边界 (Plugin as Boundary)

每个注册都是可逆的副作用：提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时按预期撤销。加载顺序通过服务依赖表达（`inject`），而非手动编排启动序列。

### 事件即扩展点 (Event as Extension Point)

拦截和策略优先使用事件（`agent/*`、`tools/*` 的 waterfall），直接能力调用优先使用服务方法。waterfall 监听器必须调用 `next()` 才能委托下去；返回而不调用则短路。

### 日志即记忆 (Log as Memory)

会话日志是模型所见上下文的来源。`deriveMessages()` 从中投影出模型历史，原始 `assistant/chunk` 事件保证回放和 UI 保真。fork、恢复、transcript、遥测和持久化都派生自该事件流。

### 作用域即可见性 (Scope as Visibility)

一项贡献（工具、提示词段、变量、限制、监听器）要么是全局的，要么归属于恰好一个 scope key。带作用域的工具在该 scope 内遮蔽同名的全局对应项——这是按 agent 定制 persona 和工具变体的机制。
