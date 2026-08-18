# 安全至关重要：威胁模型

> 当 AI 能操作你的真实项目文件和命令，安全的边界在哪里？分析 DeepSeek Harness 的安全挑战、威胁模型和纵深防御策略——审批、沙箱、计划模式、凭据隔离如何各司其职。

## 威胁模型：什么可能出错

agent harness 拥有**完整的文件系统与命令执行能力**。威胁按严重度分层：

| 威胁 | 例子 | 防线 |
|---|---|---|
| 恶意提示注入 | 网页内容诱导模型 `rm -rf /` | 审批策略（ask/never）+ 沙箱（read-only） |
| 误操作 | 模型改错了文件、跑错了命令 | 观察策略（先读后写）、计划模式、diff 渲染 |
| 凭据泄漏 | 模型把 API key 打印到输出 | 凭据隔离（只引用不存值）、环境清除 |
| 失控循环 | 反复请求同一个被拒的操作 | 单调 guard、拒绝追踪、轮次终止 |
| 递归委派爆炸 | 子 agent 无限委派子 agent | `delegationDepth` 预算、`maxDepth` 上限 |
| 遥测泄露 | 匿名身份与行为数据外泄 | 匿名 UUID、可禁用遥测、明确披露 |

## 纵深防御：四层防线

```text
第 1 层：模型面对什么（提示词工程）
  system-prompt 组装 · persona · plan:policy 软指引
        ↓
第 2 层：操作是否放行（审批）
  tools/pre-execute → ApprovalPolicy: ask | never
  ToolGuard（单调，无法撤销）
        ↓
第 3 层：进程能碰什么（沙箱）
  ctx.sandbox → SandboxMode: read-only | workspace-write | danger-full-access
  bwrap/Landlock/Seatbelt/Windows-ACL 后端
        ↓
第 4 层：发生了什么（审计与持久化）
  session 事件日志 · approval/asked + approval/decided 审计对
  hook/invoked + hook/result · 模型可见即已记录
```

## 各防线如何协同

### 审批：ask/never

每次敏感操作在分派前经过 `tools/pre-execute` waterfall（见[审批模型](../safety/permission-model.md)）：

* `ask`（默认）：委托给应答者链（UI 通道 / ACP 机器决策）；无应答者时 fail-closed 为 `unavailable`
* `never`：确定性返回 `rejected`，**在服务内部、waterfall 分发之前强制执行**——即使后来以 `prepend` 注册的应答者也无法绕过

### 沙箱：权限系统之外的第二道防线

即使审批放行，进程仍在沙箱策略下运行（见[沙箱机制](../safety/sandbox.md)）：`read-only` 拒绝写入、`workspace-write` 限制在工作区根与临时区域、`danger-full-access` 绕过隔离（由消费方直接 spawn 原始 argv，不调用 `ctx.sandbox`）。**审批与沙箱独立配置、独立执行**——计划模式只读不写是软指引，真正的写入限制来自沙箱策略。

### 凭据：值不落配置

* settings 分节与 cordis.yml 条目只带**凭据引用**（`CredentialRef`），值归 `ctx.credentials` 提供方（env/文件层）
* 密钥是只写的：Web UI 页面只收到脱敏描述符，明文密钥存储在 `$DSH_HOME/.credentials.yaml`，settings 只保留引用
* 本地 shell 执行器在合并调用方 env 之前**清除环境中的凭据**
* 消费方每操作重新解析引用——凭据轮换无需重启

### 身份：匿名与可审计

匿名身份是**每 harness home 一个的随机 UUID**（`$DSH_HOME/.anonymous-user-id`），绝不从 hostname/网络/git 派生；删除文件即重置，不同 home 不可关联。遥测经 `ctx.sessionTelemetry` 上报，`DSH_TELEMETRY_DISABLED` 可停用导出（见[身份与遥测](../internals/telemetry-identity.md)）。

## 死循环防护

单调 guard 保证**没有任何机制能把一个被拒绝的调用翻回放行**：`tools/pre-execute` 的 allow/deny/ask 决策之后，`ToolGuard` 只能返回拒绝理由或 `undefined`——因此监听器顺序永远无法把 deny 变成 allow。这是与"规则可被覆盖"的权限模型最根本的区别。

## 安全相关配置一览

| 配置 | 位置 | 效果 |
|---|---|---|
| `approval/policy` | 会话策略 | `ask` / `never` |
| `sandbox/mode` | 沙箱策略 | `read-only` / `workspace-write` / `danger-full-access` |
| 权限预设 | `dsh-permission-presets` | 把沙箱 + 审批捆成具名预设 |
| `DSH_TELEMETRY_DISABLED` | 环境变量 | 停止遥测导出 |
| `enableRunInBackground` | bash 工具配置 | 移除后台运行参数 |
| `delegationDepth` | 会话元数据 | 子 agent 递归预算 |

## 结论

DeepSeek Harness 的安全哲学可以概括为一句话：**把"模型想做什么"（审批）与"进程能做什么"（沙箱）分开，让所有决策可审计（日志），并且让防线不可被绕过（单调）**。接下来的三页逐一拆解审批模型、沙箱机制与计划模式。
