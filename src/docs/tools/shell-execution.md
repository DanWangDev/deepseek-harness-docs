# 命令执行：Bash 与 PowerShell

> 从源码角度解析 DeepSeek Harness 的 shell 执行 seam（`packages/shell`）：`bash` 与 `pwsh` 工具如何通过 `ctx.shell` 执行命令、`resolve()` 如何拆分请求与规格、前台结果如何正交报告，以及与沙箱和后台任务如何联动。

## 能力拆解

shell 执行 seam 是一个标准的能力三件套：

| 角色 | 包 | 说明 |
|---|---|---|
| Service Definition | `dsh-shell` | `ctx.shell` + 请求/结果词汇 |
| Service Provider | `dsh-bash-local` / `dsh-bash-sandbox` | 本地执行器与沙箱化执行器（Windows 组合用 `dsh-pwsh-local` / `dsh-pwsh-sandbox`） |
| Consumer | `dsh-tool-bash`（`bash` schema）/ `dsh-tool-pwsh`（`pwsh` schema） | 面向模型的命令工具 |

Windows 组合中 `bash` 由 `pwsh` 方言替代：路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`，每次调用在新进程中运行，不使用持久 PTY 会话。

## `resolve()` 拆分：请求 vs 规格

该 seam 将**面向模型的请求**与执行器实际使用的**完全解析后的 spec** 分开：

```ts
/** A caller's execution REQUEST: optional fields are filled by ShellExecutor.resolve from config. */
interface ShellExecRequest {
  command: string
  workdir?: string          // 默认：实现配置
  timeoutMs?: number        // 实现会封顶
  stdoutMaxBytes?: number   // 前台 stdout 捕获预算
  signal?: AbortSignal
  stdin?: string            // 受信任的进程内插件输入
  env?: Record<string, string>
  dshEnv?: DshEnvironment   // 受管 DSH_* 变量
  sandboxPolicy?: SandboxExecutionPolicy
}
```

工具层在二者之间调用 `ctx.shell.resolve(request)`（仓库的"包边界处显式优于隐式"规则）；`ShellExecSpec` 携带的是已解析的值（`workdir`、`timeoutMs`、`stdoutMaxBytes` 均为必填）。

`stdin` 和 `env` 是**受信任的进程内插件输入**，不由 `dsh-tool-bash` 暴露（模型需要 stdin 时用 heredoc 或管道）。本地执行器会先清除环境中的凭据，再合并调用方显式提供的 env。

## 前台运行：正交的结果报告

一次已完成（或被终止）的前台运行的结果**独立报告**——一个进程可以同时超时并以退出码 0 退出（因为它捕获了信号）：

```ts
/** The outcome of one completed (or killed) foreground run. */
interface ShellRunResult {
  exitCode: number | null   // 信号终止时为 null
  signal: NodeJS.Signals | null
  timedOut: boolean         // 执行器自身超时是否第一个切断
  aborted: boolean          // 调用方取消是否介入
}
```

调用方永远不会把一次被提前中断的运行误读为正常成功——`timedOut`、`aborted`、`signal`、`exitCode` 各自独立为一个字段。

## 后台任务：与 jobs 联动

`bash` 工具的 `run_in_background` 参数（默认启用）把命令注册到通用 `ctx.jobs` 运行时：

```text
bash("pnpm run test", run_in_background: true)
  → ctx.jobs.start({ kind: 'bash', label: 'pnpm run test', owner: agent })
  → 返回 job id（bash-N）
  → job_output / job_list / job_kill 三个工具收集或停止
  → 完成通知经 agent.inject() 作为 user/message 送达
```

禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。详见[后台任务](../features/jobs.md)。

## 与沙箱联动

沙箱化执行器（`dsh-bash-sandbox`）在 spawn 前把命令 argv 包装进沙箱 runner：

```text
bash("rm -rf /etc")   sandboxPolicy = read-only
  → ctx.sandbox.confine(argv, policy)
  → runner argv：bwrap/Landlock/Seatbelt/Windows-ACL 包装
  → EROFS / EACCES / EPERM 等拒绝方言被识别为 denial
```

拒绝（denial）与 runner 失败（runner failure）被区分对待：前者意味着沙箱正常工作并阻止了受限命令，后者意味着沙箱基础设施自身失败。详见[沙箱机制](../safety/sandbox.md)。

## 执行语义要点

* **每次调用在新进程中运行**：无持久 shell 状态；需要持久会话时使用 `terminal_*` 工具族（选择启用）
* **`DSH_*` 环境命名空间**：归 harness 所有的子进程事实（如 `DSH_WEB_URL`）；执行器丢弃环境中的既有 `DSH_*` 名称后再合并受管快照，当前事实不会继承陈旧值
* **输出截断**：前台 stdout 有捕获预算；后台任务与 stderr 有各自的输出上限；截断时报告 `truncated` 并可 spill 完整流到文件（见[搜索与导航](../tools/search-navigation.md)中的 spill 机制）

## 工具 schema 要点

| 工具 | 行为 |
|---|---|
| `bash` | 通过 `ctx.shell` 执行 shell 命令；支持 `run_in_background` |
| `pwsh` | Windows 组合中的 PowerShell 方言；逐项对应 bash 工具调用 |

命令执行是 agent 能力的核心——**完整的 shell 访问权**意味着它可以做任何你在终端里能做的事，也因此需要对应的安全机制来约束这个能力（审批策略 + 沙箱策略，见[安全](../safety/why-safety-matters.md)整组）。
