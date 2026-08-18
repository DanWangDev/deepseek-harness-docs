# 为什么写这份白皮书

> 对 DeepSeek Harness 源码与官方文档的系统性分析。目标读者是想要理解、使用并扩展这套 agent harness 的开发者——从"它和 Claude Code 有什么不同"到"我怎么给它写一个插件"。

## 背景：一个正在快速迭代的 developer preview

DeepSeek Harness 由 DeepSeek AI 开发，目前处于 *developer preview* 阶段并快速迭代——官方 README 明言 **THERE WILL BE COMPATIBILITY-BREAKING CHANGES**。这意味着：

* 官方文档（`docs/` 目录）是**当前状态**的准确投影，但不承诺向后兼容
* 磁盘格式（会话日志、SQLite schema）会在版本间演进，旧格式被拒绝而非被兼容
* 术语体系已经稳定：seam、scope、turn、step、goal、preset……这些词在[术语表](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/glossary.zh.md)中逐一锁定

在这样一个快速迭代的项目上，最可靠的知识来源不是博客文章，而是**源码本身**：类型声明、包 README 与事件目录。这份白皮书正是以它们为准绳整理而成。

## 它和 Claude Code 白皮书的关系

[Claude Code 白皮书](https://ccb.agent-aura.top/docs/introduction/what-is-claude-code)是对 Anthropic 官方 CLI 的逆向工程——通过反编译单文件 bundle 解析运行时行为。DeepSeek Harness 不需要逆向：它是开源的，源码就在 `packages/` 下。因此这份白皮书采用相同的**体例**（一句话定义、对比表格、流程图示、源码级拆解），但内容来自**正向工程**：

| 维度 | Claude Code 白皮书 | 本白皮书 |
|---|---|---|
| 知识来源 | 反编译 TypeScript bundle | 开源仓库源码 + 官方文档 |
| 核心对象 | `query()` 异步生成器循环 | Cordis 插件树 + agent-loop 驱动器 |
| 权威性 | 逆向推断，可能有误 | 源码即真源，可随时核对 |
| 叙事视角 | "被隐藏的机制" | "公开架构的完整地图" |

## 这份白皮书回答什么问题

按阅读路径组织，每一章回答一组问题：

| 章节 | 回答的问题 |
|---|---|
| 介绍 | 它是什么？架构长什么样？为什么这样设计？ |
| 核心机制 | Cordis 怎么工作？循环怎么转？会话怎么记？提示词怎么拼？作用域怎么分？ |
| 工具系统 | 工具怎么注册、怎么执行、怎么渲染？八个工具族各做什么？ |
| 上下文工程 | 上下文怎么压缩？Token 预算怎么算？ |
| Agent 机制 | preset 怎么组装能力？目标怎么持久化？自我修改怎么做？ |
| 可扩展性 | 怎么写插件？怎么桥接 Claude Code hooks？技能系统怎么用？SDK 怎么接？ |
| 安全 | 威胁模型是什么？审批和沙箱怎么把关？计划模式怎么运作？ |
| 功能与使用 | Web UI 怎么用？模型提供方怎么配？命令和后台任务怎么管理？ |
| 内部机制 | 仓库怎么布局？运行时不变式是什么？身份与遥测怎么工作？ |

## 写作方法

1. **源码优先**：每个机制都对应一个真实的类型、服务键或事件名，并给出 `packages/` 下的源码路径
2. **事件即事实**：凡是模型可见的内容，必然以会话事件落盘——因此"系统实际做了什么"可以从 `SessionEventMap` 反推
3. **术语一致**：沿用官方术语表（seam、scope、turn、step……），不发明新词
4. **当前状态**：描述 shipped 的现实，不描述"即将到来"的功能

## 边界与免责声明

* 本文档覆盖**已实现并交付**的功能；`developer preview` 下个别细节可能已随最新提交变化——请以源码为准
* 本文档不是官方文档的镜像，而是独立整理的分析性读物；需要逐字段契约时，请查阅 [docs/](https://github.com/deepseek-ai/deepseek-harness/tree/main/docs) 与各包 README
* 演示性的 `examples/` 组合不在本文档范围之内，但示例代码是理解最小可用组合的好入口

## 如何阅读

* 每页以一句话定义开篇，随后是表格与图示
* 页间通过"上一页 / 下一页"串联；左侧边栏提供任意跳转
* 代码块与类型名是唯一权威的"锚点"——在仓库中 `grep` 这些名字可以验证任何论断
