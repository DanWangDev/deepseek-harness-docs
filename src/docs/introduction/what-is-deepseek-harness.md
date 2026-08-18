# 什么是 DeepSeek Harness

> DeepSeek Harness 是运行在 Node.js 之上的 agent harness：它不是一个聊天机器人，而是一个**一切皆插件**、由 Cordis 驱动的 agent 运行平台——在你的项目目录里读代码、改文件、跑命令、调试程序，并把这一切以可回放的事件日志持久化。

## 一句话定义

DeepSeek Harness（简称 `dsh`）是一个**开源 agent harness**。它不绑定任何 UI：Web 界面、CLI、headless 一次性运行器、Agent Client Protocol（ACP）自动化服务器只是同一套核心之上的不同外壳。理解它的关键是三个词：

| 定位关键词 | 含义 |
|---|---|
| **Agent harness** | 承载"模型 + 工具 + 记忆 + 策略"的完整运行平台，不是 API wrapper，也不是单一 CLI |
| **一切皆插件** | 产品每一部分都是 Cordis 插件——模型适配器、工具注册表、会话日志、agent loop 本身都是，任何一部分都可以从配置替换 |
| **事件溯源** | 会话历史是一份仅追加的 `SessionEvent` 日志，模型看到的上下文从日志*派生*，回放、fork、恢复、遥测都从同一事件流重建 |

## 技术定位：与同类产品的架构差异

与 Claude Code 等 terminal-native 工具的差异不是功能清单，而是**架构模式**：

| 产品 | 架构模式 | 运行位置 | 扩展方式 | 历史存储 |
|---|---|---|---|---|
| **DeepSeek Harness** | Plugin-based harness（Cordis 插件树） | Node.js 进程 | 插件/组合包（cordis.yml） | 事件溯源会话日志 |
| Claude Code | Terminal-native agentic loop（单文件 bundle） | 本地进程 | hooks / MCP / skills | JSONL transcript |
| Cursor / Copilot | IDE-integrated autocomplete + chat | IDE 进程内 | IDE 扩展 API | 云端 |
| OpenHands | Docker 容器化 agent runtime | 容器 | SDK / CLI | 工作区文件 |

核心差异：**DeepSeek Harness 把"循环本身"也做成了可替换的插件**。`ctx.agentLoop` 只是公开 `Agent` 约定的一个具体实现（`dsh-agent-loop`），扩展插件依赖 `ctx.agents` 而绝不直接依赖 agent-loop——因此换一个 driver、换一套调度策略、甚至把轮次委派给另一个产品，都不需要打补丁。

## 端到端示例：从输入到输出

当你在 Web UI 中输入"帮我修一下这个仓库里失败的测试"时，系统发生了什么：

```text
┌────────────────────────────────────────────────────────────┐
│ 1. 外壳层 (dsh web → Web UI / CLI / ACP / Python SDK)      │
│    dsh --profile web 启动浏览器应用；输入进入 Agent inbox  │
├────────────────────────────────────────────────────────────┤
│ 2. 循环层 (core/agent-loop — ctx.agentLoop)                │
│    turn/start → 认领 inbox 消息 → 组装提示词与工具 schema  │
├────────────────────────────────────────────────────────────┤
│ 3. 组装层 (core/system-prompt — ctx.systemPrompt)          │
│    按 order 拼接提示词段落 + ctx.tools.schemas() 工具清单  │
├────────────────────────────────────────────────────────────┤
│ 4. 模型层 (llm/llm — ctx.llm)                              │
│    agent/request → llm/stream 流式请求 → assistant/chunk*  │
├────────────────────────────────────────────────────────────┤
│ 5. 工具层 (core/tools — ctx.tools)                         │
│    tool/call → pre-execute 审批 → execute → post-execute   │
│    → 实际执行: bash / read / write / grep / subagent ...   │
├────────────────────────────────────────────────────────────┤
│ 6. 持久层 (core/session + persistence)                     │
│    每个模型可见的事实追加为 SessionEvent → JSONL/SQLite    │
└────────────────────────────────────────────────────────────┘
```

一次典型的 agentic 轮次可能包含多步（step），每一步是一次模型请求加它调用的工具：

| Step | AI 决策 | 工具调用 | 结果 |
|---|---|---|---|
| 1 | 先看测试输出 | `bash("pnpm run test")` | 3 个失败用例 |
| 2 | 定位失败文件 | `grep("it(.*fails", "src/")` | 测试文件位置 |
| 3 | 读取源码 | `read("src/foo.test.ts")` | 测试代码 |
| 4 | 修复实现 | `edit("src/foo.ts", old, new)` | 文件已修改 |
| 5 | 验证修复 | `bash("pnpm run test")` | 全部通过 |

每一步都是模型自主决策的——它决定用哪个工具、传什么参数、何时停止。这就是 "agentic" 的含义；而**每一步模型可见的输入都被追加进会话日志**，这是 DeepSeek Harness 与其他产品不同的硬性运行时不变量（见[运行时不变式](../internals/invariants.md)）。

## 它不是什么

* **不是聊天机器人**：输出不是纯文本回复，而是实际的文件修改、命令执行与状态变更
* **不是 API wrapper**：它有自己的工具系统、权限模型、上下文工程、会话管理与插件生态
* **不是单体内核**：不存在需要打补丁的特权内核——扩展 dsh 的方式是把插件挂载到其他插件旁边，各注册是副作用，插件卸载时自动撤销
* **不是无脑执行器**：每个敏感操作都要经过审批策略（`ask`/`never`）与沙箱策略（`read-only`/`workspace-write`）的双重把关

## 为什么选择"一切皆插件"

插件化不是口号，而是四个实际收益：

* **可替换性**：换一个模型提供方、换一个文件系统后端、甚至换整个循环实现，只改组合配置
* **可组合性**：运行中的 `dsh` 是一棵插件树，由 profile 按序叠加组合包与 patch 层构成；`--dump-config` 可以打印你机器上实际的配置树
* **可审计性**：每个注册都有对应的 disposer（资源释放函数），reload 与 teardown 时按预期撤销，没有泄漏的全局状态
* **自我修改**：插件可以动态定义、运行并停止其他插件（见[自我修改](../agent/self-modification.md)）——这是扩展生态的底层能力

代价是需要理解 Cordis 的插件模型（五个核心概念即可上手，见[Cordis：一切皆插件的基座](../core/cordis.md)），以及随之而来的加载顺序、作用域与事件分发语义。

## 快速开始

```sh
# 从 npm 直接运行（默认启动 Web UI，地址 http://127.0.0.1:3080）
npx @deepseek-ai/dsh web

# 从源码运行
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install && pnpm run build
pnpm dsh web
```

启动后打开**设置 → 模型**输入 DeepSeek API 密钥，选择工作区，即可开始对话（见[Web UI](../features/web-ui.md)）。
