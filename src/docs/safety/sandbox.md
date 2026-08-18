# 沙箱机制：进程隔离

> 系统性梳理 DeepSeek Harness 的进程沙箱：`SandboxMode` 三档文件效果策略、bwrap/Landlock/Seatbelt/Windows-ACL 四种本地后端、`full`/`partial` 强制执行完整性，以及消费方如何区分"被沙箱拒绝"与"沙箱自身失败"。

## 什么是沙箱

沙箱（`ctx.sandbox`）把**与宿主共享文件系统和内核的子进程 argv** 包装在文件效果策略中，而不将消费方耦合到特定平台运行器：

* 这是权限系统**之外**的第二道防线——即使审批放行，进程仍在沙箱策略下运行
* 网络与进程可见性**不在** `SandboxMode` 的定义范围内
* 容器、microVM 和远程执行是完整能力 seam 的同级实现，而非 `ctx.sandbox` 的提供方

## 能力拆解

| 角色 | 包 |
|---|---|
| Service Definition | `dsh-sandbox`（`ctx.sandbox` + 词汇） |
| Service Provider | `dsh-sandbox-local`：Linux bwrap/Landlock、macOS Seatbelt、Windows ACL 受限令牌后端 |
| Consumer | `dsh-bash-sandbox`、`dsh-pwsh-sandbox`（以及任何需要限制子进程的消费方） |

## 三档模式

```ts
/** File-effect policy for confined processes. */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

| 模式 | 允许 | 说明 |
|---|---|---|
| `read-only` | 仅必需的 sink（如 `/dev/null`） | 拒绝写入；POSIX runner 授予 shell 所需的 `/dev/null`，Windows ACL runner 不授予任何显式可写根 |
| `workspace-write` | 工作区根 + 后端定义的临时区域 | 常规 agent 工作模式 |
| `danger-full-access` | 一切 | **绕过隔离**；消费方直接 spawn 原始 argv，不调用 `ctx.sandbox` |

只有前两种模式可以发送给提供方；`SandboxPolicy` 只携带受约束模式。

## 强制执行完整性：full vs partial

```ts
/** Enforcement completeness for this host. `partial` means an active backend or older kernel ABI cannot govern every promised file effect. */
type SandboxEnforcement = 'full' | 'partial'
```

强制执行完整性是**后端报告的事实**：

* `full`：后端管控了该模式承诺的所有文件效果
* `partial`：活跃后端或较旧的 kernel ABI 仅管控其中一个子集——**要求绝对保证的消费方必须拒绝或向上暴露这一区别**

当前的部分强制执行情形包括较旧的 Landlock ABI，以及 Windows ACL runner 的 Everyone 与硬链接边界。

## 逐调用策略

完整执行策略**按每次能力调用解析并携带**——它不是固定在提供方上的：

```ts
/** The complete file-effect policy resolved for one capability call. */
interface SandboxExecutionPolicy {
  mode: SandboxMode
  /** Absolute root directory workspace-write may write under. */
  workspaceRoot: string
  sessionId?: SessionId
}
```

* 普通工具调用从调用会话的不可变 cwd 派生 `workspaceRoot`；部署配置是没有 agent 时的回退值
* root 先按文件系统语义规范化，再做词法规范化——包含 `symlink/..` 的 cwd 会标识 spawn 出的进程实际运行的目录
* 两个消费方可以同时以不同策略受限（bash 在 `read-only` 下，而受限子 agent 需要其状态目录可写）
* 已批准的提权重试是一次**新的调用**，携带更宽的策略

## argv 包装与分类方言

`SandboxProvider.confine` 返回消费方实际 spawn 的内容：

```ts
/** A confine result: the argv to spawn in place of the caller's own, plus enforcement completeness. */
interface ConfinedArgv {
  argv: string[]                        // runner + profile + 分隔符 + 调用方 argv
  enforcement: SandboxEnforcement
  denialSignatures: readonly string[]   // 后端拒绝方言（EROFS / EACCES / EPERM）
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

**两种正交的 stderr 分类器**：

| 分类器 | 含义 | 消费方行为 |
|---|---|---|
| `denialSignatures` | 沙箱**正常工作**时受限命令被阻止的迹象 | 判定"沙箱拒绝了这条命令" |
| `runnerFailureRules` | 沙箱 runner **在执行命令之前**拒绝或失败 | 判定"沙箱基础设施故障"，上报为基础设施问题而非普通任务失败 |

`RunnerFailureRule` 要求：进程以非零状态退出（可选允许退出码门控）+ 余下某一 stderr 行中的致命签名；先按整行精确匹配移除信息性排除项——**退出状态本身永远不能证明 runner 失败**。

## 消费方流程（以 bash-sandbox 为例）

```text
bash("rm -rf /etc")
  → 解析沙箱策略（会话 cwd → workspaceRoot, mode）
  → ctx.sandbox.confine(argv, policy)
  → spawn 包装后的 argv（bwrap/Landlock/Seatbelt/Windows-ACL）
  → 命令失败？
     先检查 runnerFailureRules → 沙箱故障，报基础设施错误
     再检查 denialSignatures → 沙箱拒绝，报"受限命令被阻止"
     都不匹配 → 普通命令失败（exit code）
```

## 平台差异速查

| 平台 | 后端 | 拒绝现象 | 已知 partial 情形 |
|---|---|---|---|
| Linux（现代内核） | Landlock | `EACCES` | 较旧 ABI |
| Linux（bwrap 路径） | bubblewrap 只读绑定 | `EROFS` 文本 | — |
| macOS | Seatbelt | `EPERM` | — |
| Windows | ACL 受限令牌 | 环境 ACL 缺口 | Everyone 与硬链接边界 |

## 与审批的边界

审批（approval）回答"**模型想做的这个操作**是否放行"；沙箱回答"**进程实际能碰什么**"。两者独立配置、独立执行：`never` 审批不解除沙箱，`danger-full-access` 沙箱不绕过审批。权限预设（`workspace-write` + `ask` 等）只是把两个旋钮捆成具名预设，强制执行仍各归各（见[审批模型](../safety/permission-model.md)）。
