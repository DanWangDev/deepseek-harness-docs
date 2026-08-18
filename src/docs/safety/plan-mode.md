# 计划模式：先看后做

> 基于源码解析 DeepSeek Harness 的 Plan Mode：`plan:policy` 提示词段落、`exit_plan_mode` 工具、`/plan` 命令与已记录状态的 pre-step 追加——以及它作为**软性指引**与沙箱/审批强制限制的边界。

## 什么是计划模式

计划模式是 `dsh-plan-mode`（`ctx.planMode`，`PlanModeController`）拥有的、**记录到日志的逐 agent 协作状态**：激活期间，每个模型请求都会包含一段部署持有的指引。

```yaml
# 配置（PlanModeConfig）
plan-mode:
  config:
    section: |
      You are in plan mode. Do not modify files. Research and present a plan
      using the exit_plan_mode tool, starting with a `#` heading.
```

`section` 缺失、为空白或不是字符串，以及任何未知键，都会在插件加载时失败。计划模式激活期间，确切的 `section` 文本以 order 50 渲染为 `plan:policy` 系统提示词段落；未激活时**不贡献任何文本**。

## 软性指引，不是强制限制

计划模式是**软性指引**——它通过提示词引导模型，而不是强制执行：

| 机制 | 类型 | 是否强制 |
|---|---|---|
| `plan:policy` 段落 | 提示词 | 否（软指引） |
| 沙箱模式 | `SandboxMode` | 是 |
| 审批策略 | `ApprovalPolicy` | 是 |

沙箱模式与审批策略**都不读写计划状态**——部署需要分别配置它们（计划模式下想要"只能读不能写"，需要同时配置 `sandbox: read-only` 与审批策略）。

## 已记录状态与恢复

`plan/mode`（`{ active: boolean }`）是仅日志、整值替换的会话事件：持久且可回放，**绝不进入模型 transcript**。

```ts
foldPlanMode(events, end?)  // 返回前缀中最后一条已记录值；没有时返回 false
```

生效状态始终是会话日志的纯折叠——恢复、fork 与压缩无需实时镜像即可复原；UI 通过 `session/event` 观察已提交的切换。

## 待生效选择与 pre-step 追加

```ts
get(agent: Agent): { active: boolean; pending?: boolean }
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

由于每个会话事件都位于轮次之内，用户选择会保持**待生效**，直到下一个被接受的轮内 pre-step 在派生请求之前追加该选择：

* agent 运行时，唯一的追加点是前置注册的 `agent/pre-step` 监听器——它观察每个候选请求步骤，先调用下游监听器，只在下游接受该步骤后追加
* 轮次之间选择立即追加（`committed`）；轮次内保持待生效（`queued`）
* 追加用户选择时还会记录一条插件来源的 `user/message` 通知——仅当最后记录的请求头描述的是另一种状态时（模型恰好在上下文变化时收到通知，绝不重复）

## 退出工具与 `/plan` 命令

### `exit_plan_mode`

* 计划模式未激活时**仍保持注册**——进入/离开计划模式只改变提示词段落，绝不改变请求的工具目录（schema 稳定）
* 计划模式之外执行会失败
* 计划模式中：要求一份以 `#` 标题开头的完整 markdown 计划，通过**用户交互 seam**（`ctx.userQuestions`）呈交评审
* 批准 → `{ approved: true }` + 静默（不叙述）的待生效退出，由下一个被接受的轮内 pre-step 追加——计划指引在 assistant 当前这批工具调用的剩余部分继续生效
* "继续规划" → 一次携带用户反馈的失败调用，模型据此修订并再次呈交
* 评审期间交互通道缺失或服务重载 → 调用失败，**不会静默离开计划模式**

### `/plan` 命令

`ctx.commands` 被组合时，插件注册 `/plan [off|message]`：

* 单独的 `/plan` → 选择计划模式
* 任何其他非空消息 → 先选择计划模式，再通过 `agent.steer()` 提交该文本，使其在计划指引下成为下一步骤的普通已记录用户消息
* 确切参数 `off` → 选择未激活（还会在待生效条目被追加并对请求可见之前取消它）

## 生命周期示意

```text
用户: /plan
  → plan/mode { active: true }（轮次之间 → committed）
  → 下一 pre-step 追加 → plan:policy 段落进入请求
模型: [只读研究] … exit_plan_mode(plan)
  → userQuestions 评审
  → 批准 → 待生效 exit
  → 下一 pre-step 追加 plan/mode { active: false } → 恢复常规指引
```

## 与参考实现的对比

Claude Code 的 Plan Mode 通过 `EnterPlanModeTool`/`ExitPlanModeV2Tool` 切换权限上下文（`prepareContextForPlanMode()` 只读模式，退出时恢复），并有独立的计划文件持久化与审批流程。DeepSeek Harness 的版本更简：**计划状态是日志折叠，指引是提示词段落，退出是带评审的工具调用**——没有独立的权限上下文切换，权限由沙箱/审批策略各自掌管（这正是"软指引"设计的全部含义）。
