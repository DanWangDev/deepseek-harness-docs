# 自我修改：插件即运行时

> DeepSeek Harness 允许 agent 定义、运行并停止带版本的 Cordis 包——不是沙箱里的玩具脚本，而是**动态 Package 生命周期**：定义注册表 + vm 沙箱 + 动态工具注册，让 agent 能够修改自己的运行时。

## 什么是自我修改

"自我修改"指 agent（或插件）在运行时动态创建新的插件并挂载进正在运行的 Cordis 树。这是扩展生态的底层能力：一个插件可以定义另一个插件，而不需要重启进程。

实现是 **cordis 工具集**（`@deepseek-ai/dsh-tool-cordis`，不在任何随产品发布的树中，需要显式选择启用）：

| 工具 | 行为 |
|---|---|
| `cordis_define` | 定义一个新的动态 Package（带版本的 Cordis 包） |
| `cordis_inspect_list` / `cordis_inspect_query` / `cordis_inspect_self` | 查询运行时元数据（获准公开的部分） |
| `cordis_run` | 运行动态 Package |
| `cordis_stop` | 停止动态 Package |
| `cordis_undefine` | 撤销定义 |

## 动态运行时

工具集注入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`——它拥有**定义注册表**和 **vm 沙箱**；组合缺少它时这些工具不会激活。

```text
模型: cordis_define({ name, version, code })
  → 定义注册表记录带版本的包
  → cordis_run 在 vm 沙箱中挂载该 Package
  → Package 的 apply(ctx) 执行：注册工具、服务、事件监听器
  → 动态注册的工具出现在下一组装（request/header 记录工具集变化）
  → cordis_stop 卸载：注册的副作用按 disposer 撤销
```

运行中的 Package 在停止、undefine 或 DSH 重启前可以注册**额外的模型可见工具**；发生这类工具集变化时，系统会记录**完整且有变动的请求头**——模型可见即已记录的不变量对动态工具同样成立。

## 沙箱与生命周期

`cordis_run` 的 Package 代码在 vm 沙箱中执行——它访问的是 harness 的插件 API（`apply(ctx)`），但运行在受控的 JS 上下文中。动态 Package 与静态插件的契约相同：注册是可逆的副作用，dispose 时撤销。

## 为什么这很重要

自我修改把"扩展 harness"从**开发时活动**变成**运行时活动**：

* agent 可以在会话中定义自己的工具并立即使用
* 插件作者可以在不重启进程的情况下迭代组合
* 新能力可以"现场锻造"，而不是预编译进发行版

代价是信任：动态 Package 代码拥有真实运行时的访问权——因此 cordis 工具集**默认不启用**，需要显式选择，且其文档明确标注"不在任何随产品发布的树中"。

## 相关机制

* **HMR（热模块替换）**：`dsh-client-hmr` 与 Cordis 的 reload 机制让组合层插件可以热更新
* **Hooks 桥接**：外部 `hooks.json` 是另一条扩展路径（见[Hooks](../extensibility/hooks.md)）
* **Extensions seam**：`packages/extensions` 包组允许 agent 定义带版本 Cordis 包、运行 host+浏览器两半、写码前查询获准公开的运行时元数据（`ctx.cordisInspect`）

三者构成完整的"运行时扩展"图景：HMR 是开发期热更新，hooks 是外部脚本回调，cordis 工具集与 extensions 是 agent 驱动的动态定义。
