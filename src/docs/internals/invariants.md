# 运行时不变式：架构的自证

> DeepSeek Harness 的架构承诺以可机械校验的不变式落地：模型可见即已记录、guard 单调、注册是可逆副作用、作用域决定可见性与生命周期、品牌化 ID 防互换——这些不是风格，是门禁。

## 第一不变量：模型可见即已记录

> 抵达模型请求的一切都必须能从日志重建。

```text
模型请求
  ├─ 系统提示词 ──► request/header（EpochHeader.system）
  ├─ 工具 schema ─► request/header（EpochHeader.tools）
  ├─ 历史消息 ────► deriveMessages() ← surface 事件
  └─ 注入上下文 ──► user/message（agent.inject() 通道）
```

由一项**运行时不变量**断言：新增模型可见输入就需要新增会话事件（扩展 `SessionEventMap` 并从日志渲染）。反过来的推论同样成立——**模型看不见的**（`output`、`execute`、`finalizeContent`、`timeoutMs`、`isConcurrencySafe`、`presentCall`/`presentResult`）绝不进入模型请求：`schemas()` 白名单只投影 `name`/`description`/`parameters`。

## 第二不变量：Guard 单调

> 没有任何机制能把一个被拒绝的调用翻回放行。

```ts
/** A monotonic execution guard evaluated after every tools/pre-execute listener and before the tool body. */
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

`ToolGuard` 的返回类型有意不包含 allow 结果：`undefined` 保留 waterfall 的决策，返回的 reason 只能缩减权限——因此**监听器顺序永远无法把 deny 变成 allow**。同理，`never` 审批策略在服务内部、waterfall 分发之前强制执行，后来以 `prepend` 注册的应答者也无法绕过。

## 第三不变量：注册是可逆副作用

> 每个注册都有对应的 disposer；插件卸载时按预期撤销。

* 提示词片段、工具 schema、适配器、提供方、监听器通过 `ctx.effect()` / `ctx.on()` 安装
* 注册表 `register()` 返回精确的 disposer——复合 effect 通过 yield 它来嵌套 teardown 顺序
* 作用域世界随 agent 卸载整体回卷：`agent.ctx` 上的注册"unwind on disposal, reject registration afterward"

## 第四不变量：作用域决定可见性与生命周期

> 带作用域的注册既决定可见性，也绑定生命周期——同一事实决定两者。

* 只有两层：全局与 scope-local；带作用域的注册不向下继承给 subagent
* 子树行为通过 lineage 数据表达，从不通过 scope 结构
* 被 restriction 过滤掉的全局工具与不存在的工具无法区分（"可见性而非权限"）

## 第五不变量：品牌化 ID 防互换

> 在包之间传递的 ID 都经过品牌化——结构上是字符串，但在类型层面不可互换。

```ts
/** A string carrying a compile-time-only brand B. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

`SessionId`、`CallId`、`JobId`、`ApprovalRequestId`、`GoalId`、`FsTargetKey`、`FsVersion`……不能把 `SessionId` 传给需要 `CallId` 的位置——编译期即拒绝。`Branded<B>` 原语在零依赖的 `dsh-brand` 包中，任何包都能品牌化自己拥有的 id。

## 第六不变量：闭包以判别标签终结

> 对标签做 switch；封闭联合以 assertNever 结尾，可合并扩展联合以文档化 default 放行。

| 联合 | 性质 | 结尾方式 |
|---|---|---|
| `StreamChunk` | 封闭 | `assertNever`（新变体在每个消费方处编译错误） |
| `SessionEvent` | 可合并扩展 | `default` 放行未知插件事件 |
| `TurnEndReasonMap` | 可合并扩展 | `default` 放行 |
| `PreToolDecision` / `PostToolDecision` | 封闭 | 穷举 |

## 第七不变量：错配置失败要响

> 错配置在加载时失败要响；永远不要静默跳过缺失的引用。

* 计划模式 `section` 缺失/空白/非字符串 → 插件加载失败
* 权限预设要求隔离的 shell 执行器 + approval 服务 → 配置错误加载即失败
* 重复的工具/提示词段注册 → 抛异常
* 未知的事件类型无 `ignorable: true` → 读取方拒绝重建会话，而非静默丢弃

## 不变量如何被校验

| 机制 | 校验内容 |
|---|---|
| `dsh-session/invariant` 插件 | 轮次与步骤编号、执行事件封闭、工具调用/结果配对 |
| `dsh-tool-workflow/invariant` | 工作流 run 协议（一 start、成员 end 配对、结束后不更新） |
| 运行时不变量配套（AGENTS.md） | 检查权威事件流或可变数据，而非服务/方法存在性 |
| 文档门禁 | `verify-cordis-catalog`、`verify-tool-catalog`、`verify-type-equiv`（粘贴的类型声明不得漂移） |

## 设计取舍

这些不变量不是"好习惯"——它们是**可机械校验的契约**，因此：

* 错误的实现被编译期拒绝（品牌化 ID、封闭联合的 assertNever），而不是运行时才发现
* 错误的配置被加载期拒绝（fail loud），而不是默默降级
* 错误的监听器被单调性拒绝（guard），而不是被覆盖

这正是"没有需要打补丁的特权内核"的底气：扩展点有契约，契约有门禁，门禁有测试。
