# Agent Preset：按会话组装能力

> Agent preset 是"每个会话拥有不同能力集合"的机制：一份 `agent.cordis.yml` 描述一个 agent 的组合，按需**常驻挂载（standing mount）**到隔离 realm，会话通过 scope 父链加入——preset 是模型面对的工具、提示词与服务的组装器。

## 为什么需要 Preset

同一个进程里可以有多种 agent：默认的"全能力工程师"、只读审计员、Code Mode 的纯协议 agent、绑定特定后端子 agent……它们需要的**工具集、提示词、服务完全不同**。

Agent preset 就是为这个场景设计的：一个 preset 是目录里的一份 `agent.cordis.yml`（加上可选的 `preset.yml` 承载 `name`/`description` 显示文本），描述该 agent 的组合。

## 常驻挂载与隔离 realm

关键机制是 **standing mount**：roster 对每个 preset 做**一次进程级常驻挂载**——挂在 roster 服务自己的 UNTRACED context 下（隔离 realm），services 经各 entry 自己的 inject store 解析。这带来三个性质：

* **共享**：多个 agent 加入同一 preset 时，用的是同一个已组合实例——相同的插件对象、相同的工具注册、相同的提示词段（`composeFrom` 是 bind 而非 mount）
* **常驻**：standing mount 只组合插件，不启动 agent、不启动会话、不启动轮次——冷 transcript 读也能解析工具 presenters
* **隔离**：`isolate` realm 的服务对外部（包括 host）不可见——`serviceFor(agent, name)` 是唯一从外部读取的通道

```text
preset roster
  └─ standing mount（隔离 realm）← 每 preset 一次，进程级
       └─ agent A（scope 挂载到 preset 层）
       └─ agent B（scope 挂载到 preset 层）
          └─ child agent（composeFrom 绑定父的组合）
```

视图解析顺序：`agent → preset → global`——scope 链上最近层的条目赢得重名工具。

## 服务：`ctx.agentPresets`

| 方法 | 行为 |
|---|---|
| `list()` / `resolve(id)` | 列出/解析 preset；未 memoize——每次重读根目录，进程运行期间新写的 preset 立即可见 |
| `mount(agentCtx, id)` | 确保 standing mount 并把 agent 的 scope key 挂到 preset 层；从 agent factory 的 `setup(agentCtx)` 调用，拒绝即回滚创建 |
| `composeFrom(agentCtx, parentCtx)` | 子 agent 绑定父**同一个**组合实例——同步、无组成失败模式、不读 roster |
| `recompose(agentCtx, id)` | 重链到另一个 preset；**仅当 agent 未产出任何内容**（中途换工具会让已记录的工具调用无法复现） |
| `standingKeyFor(id)` | 冷 transcript 读的 standing scope key |
| `copy(from, id, name?)` | 唯一的 authoring 写：整目录拷贝（"拷贝与源一样可加载"） |
| `remove(id)` | 删除本地作者 preset（随发行版交付的不可删） |

切换 preset 会记录仅日志的 `agent-preset/selected` 会话事件——因此回放能重建会话当时运行在哪个组合上。

## 与 Bundle 的关系

Bundle（组合包）是"配置项 + 挂载代码"的**分发格式**；preset 是"按 agent 组装能力"的**会话机制**。两者配合：

* profile 按序叠加 bundles（如 `dsh-base` 提供基础行：模型适配器、工具、持久化、沙箱/审批策略、设置、凭据、遥测）
* preset 在 profile 之上按 agent 定制——服务行需要 `isolate` realm 时，该服务只对加入该 preset 的 agent 可见

```yaml
# agent.cordis.yml（示意）
services:
  tool-bash:
    sandbox: read-only
  deployment:persona:
    section: "You are a careful auditor."
```

## 归属位置

| 目标 | 机制 |
|---|---|
| 让某个会话拥有不同的能力集合 | 组装一个 agent preset；其中的服务行需要 `isolate` realm |
| 子 agent 继承父的能力 | `composeFrom`（绑定同一组合实例，而非重新解析） |
| 中途换组合 | `recompose`（仅未产出的 agent） |

## 常见组合

随发行版交付的 profile 模板：`web`（浏览器应用 + coding persona）与 `headless`（一次性运行器，无服务器）。`dsh-base` 是每个 profile 的第一层 bundle；平台门控 shell 栈（win32 禁用 bash 沙箱、启用 pwsh）也在 bundle 层处理。
