# 搜索与导航：glob/grep 定位

> 解析 DeepSeek Harness 的搜索导航工具：`glob` 文件匹配与 `grep` 内容搜索，基于随包提供的 ripgrep 二进制（`@vscode/ripgrep`）的高性能代码检索，帮助 AI 在百万行代码中精准定位。

## 为什么需要专用搜索工具

文件读取工具是"已知路径"的精确访问；搜索工具是"未知位置"的发现访问。agent 在动手前需要先回答三个问题：

* 这个符号定义在哪里？→ `grep`
* 哪些文件匹配这个模式？→ `glob`
* 项目结构长什么样？→ `glob("**/*")` 的有限枚举

DeepSeek Harness 把 glob/grep 做成**无条件可用的发现工具**（来自 `dsh-tool-fs-search`），通过 `ctx.subprocess` spawn 随包提供的 ripgrep 二进制执行——不需要在宿主机安装 `rg`，也不经过 shell 层。

## 执行路径

```text
模型: grep("interface Foo", "src/")
  → tools/pre-execute … allow
  → dsh-tool-fs-search 经 ctx.subprocess spawn @vscode/ripgrep
  → 作为普通前台调用运行，绝不作为后台任务
  → 结果按文件分组的匹配（search 卡片，shape: 'matches'）

模型: glob("**/*.test.ts")
  → 同样的子进程路径（ripgrep --files 模式）
  → 扁平路径列表（search 卡片，shape: 'paths'）
```

两个工具都不依赖 shell——没有命令注入面，也无需配置 shell 环境。

## 结果上限与 spill

搜索是"可能很大的结果"——一个宽泛的 grep 可能返回上千行。系统的处理：

* 结果超过上限时，通过可选的 `ctx.spillStore` 后端保存**完整的格式化列表**到文件
* 返回的定位信息（spill 路径）可供后续读取/搜索——在共置部署中，如果后端公开本地路径，模型可以继续 `read` 那个 spill 文件
* `search` 卡片的 `truncated`/`total` 字段报告内联结果是否被截断——**UI 永不把部分结果当作完整结果呈现**

`sampleOverCapGlobResults` 是部署必须显式选择的配置（默认关闭）——它让 glob 结果超限时返回采样而非失败。

## 渲染：search 卡片

完成的搜索以 `{ card: 'search', shape, title?, truncated, total, … }` 渲染意图呈现：

| shape | 含义 |
|---|---|
| `matches` | grep 结果，按文件分组的匹配行 |
| `paths` | glob 结果，扁平路径列表 |

该视图**不携带结果文本**——无 search 卡片的 UI 回退到原始结果内容。`truncated`/`total` 让 UI 可以诚实地显示"只显示了前 N 条"。

## 与 ripgrep 的关系

`@vscode/ripgrep` 是 VS Code 团队维护的 ripgrep 预编译二进制，随 npm 包分发：

* 跨平台（macOS/Linux/Windows）无需系统依赖
* 支持 gitignore 感知的搜索语义（与编辑器体验一致）
* dsh 以子进程方式调用它，使用 `CollectedOutput` 的有界收集（截断 + spill），保持内存可控

## 工具 schema 要点

| 工具 | 行为 |
|---|---|
| `glob` | 按 glob 模式匹配文件路径；`**` 递归匹配 |
| `grep` | 按正则搜索文件内容；按文件分组返回匹配 |

两者都作为普通前台调用运行，绝不作为后台任务——搜索预期是快速的；真正耗时的长任务应使用[后台任务](../features/jobs.md)通道。

## 设计取舍：专用工具 vs shell 命令

与文件编辑一样，搜索走专用工具而非 shell 命令（`rg "pattern" src/`）：

* **schema 化**：模型得到结构化的路径/匹配列表，而不是需要解析的文本输出
* **渲染意图**：search 卡片直接映射到编辑器/UI 的发现视图
* **无 shell 注入面**：参数经 JSON schema 校验，不经 shell 解释
* **可审计**：`tool/call`/`tool/result` 事件完整落盘
