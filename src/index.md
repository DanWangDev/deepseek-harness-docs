# DeepSeek Harness 白皮书

> DeepSeek Harness（`dsh`）是由 DeepSeek AI 开发的开源 agent harness：一套**一切皆插件**、由 Cordis 驱动的 agent 运行平台，覆盖从 LLM 适配、工具执行、会话持久化到 Web UI 的完整能力栈。

本白皮书仿照 Claude Code 逆向工程白皮书的体例编写：从架构全景到核心循环、工具系统、上下文工程、安全模型与内部机制，以源码级事实为准绳，逐层拆解 DeepSeek Harness 的设计。

**核心结论先行**：DeepSeek Harness 没有需要打补丁的特权内核——产品的每一部分（模型适配器、工具注册表、会话日志、agent loop 本身）都是插件，任何一部分都可以从配置替换。这是它与 Claude Code、OpenHands 等单体 agent 产品最根本的架构差异。

## 阅读路径

- 第一次接触：先读[什么是 DeepSeek Harness](introduction/what-is-deepseek-harness.md)，再看[架构全景](introduction/architecture-overview.md)。
- 想理解循环本体：从 [Agentic Loop](core/the-loop.md) 出发，配合[会话日志](core/session.md) 与 [Cordis](core/cordis.md)。
- 想理解能力边界：读[工具系统设计](tools/what-are-tools.md) 与[安全](safety/why-safety-matters.md) 整组。
- 想扩展它：读[插件开发](extensibility/plugins.md)、[Hooks](extensibility/hooks.md)、[Skills](extensibility/skills.md) 与 [SDK](extensibility/sdk.md)。

## 内容索引

左侧边栏按九个章节组织全部 36 个页面。每页以一句话定义开篇，包含对比表格、流程图示与源码级拆解；页面之间通过"上一页 / 下一页"串联成一条完整的阅读路径。

## 关于准确性

本白皮书的内容直接整理自仓库源码与官方文档（`docs/` 目录、各包 README 与类型声明），力求"模型可见即已记录"式的严谨：每条机制都对应一个真实的类型、服务键或事件名。随着项目以 developer preview 节奏快速迭代，个别细节可能与最新代码存在偏差——请以源码为准。

## 本地浏览

本站是零依赖的纯静态站点，双击打开 `site/index.html` 即可阅读；也可以通过任意静态服务器部署（详见根目录 `README.md`）。
