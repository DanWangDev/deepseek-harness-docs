# SDK 与协议：自动化接入

> DeepSeek Harness 的自动化接入面：换行分隔 JSON-RPC 2.0 的 TypeScript SDK、仅自动化的 Agent Client Protocol（ACP）服务器、`dsh` CLI 的 profile 体系，以及 Python SDK——四个入口，同一套 agent 核心。

## 一图看懂四个接入面

```text
┌─────────────────────────────────────────────────────────┐
│                   同一套 agent 核心                       │
│   ctx.agents / ctx.agentLoop / ctx.sessions / ctx.tools  │
└─────────────────────────────────────────────────────────┘
     ▲              ▲               ▲              ▲
     │              │               │              │
  Web UI       CLI (dsh)      JSON-RPC SDK    ACP 服务器
  (浏览器)     (web/headless)  (TS + Python)   (自动化客户端)
```

## JSON-RPC SDK

`packages/sdk` 三个包：

| 包 | 职责 |
|---|---|
| `dsh-sdk-protocol` | 换行分隔 JSON-RPC 2.0 传输：一紧凑 JSON 帧一行；id+method=请求、id=响应、method=通知；畸形行忽略 |
| `dsh-sdk-client` | TypeScript client |
| `dsh-sdk-jsonrpc-server` | stdio 服务：每个 `sessionId` get-or-create 一个 agent；**stdout 只承载协议帧** |

**Wire 面**（三个方法 + 四个通知）：

```text
initialize → { serverInfo: { name: 'deepseek-harness-sdk-runtime', version } , maxTokens }
session/prompt { sessionId, content } → { messageId }      ← 入队即返收据
shutdown → flush → dispose → exit 0

通知: session.event（全会话未过滤） / session.status（running/idle）
      subagent.started / subagent.finished（仅进程内）
```

已知限制：无协议版本协商（`serverInfo.version` 为 `0.0.1` 未校验）、无 cancel/session-close 方法。

## ACP：仅自动化

`@deepseek-ai/dsh-acp` 是 **Agent Client Protocol** 服务器（JSON-RPC stdio，`AgentSideConnection` 驱动 `ctx.agents`）——一个**传输适配器**，不暴露编辑器导航/回放/命令/模式等 UI 概念。

| 方法 | 行为 |
|---|---|
| `initialize` | 只按需广告 image prompt，不广告 session/editor/terminal/fs/MCP 能力 |
| `session/new` | 新鲜 agent，绝对 cwd；拒绝非空 `additionalDirectories`/`mcpServers` |
| `session/prompt` | 保序文本 + inline 图片；每 session 一个 in-flight；quiescence 报 `end_turn`/`cancelled` |
| `session/update` | 逐 committed `assistant/message` 块发 `agent_message_chunk` |
| `session/request_permission` | 桥拥有的带 tool call id 审批请求：one-shot allow/reject |

限制：仅新鲜会话、仅栅格图片（PNG/JPEG/WebP/GIF）、仅已提交答案。主客户端是 `dsh-subagent-acp`；`pnpm run demo:acp` 启动演示。

## Typert：类型安全远程调用

Host↔Client 的远程方法调用层（`ctx.typert` + `ctx.typertGateway`）：业务服务用 `@Remote` / `@RemoteScope(key)` 声明对 Client 开放的方法；复杂 Host 对象经 `TypertLookupMap` 映射为 wire identity（如 `Agent` → `agentId`）。请求只发 endpoint + 具名 `args`；协作式取消 = 最后一个 `signal: AbortSignal` 参数。Client 用具体函数（`ctx.remote.<namespace>`）而非 Proxy。

## CLI：profile 体系

```sh
dsh web                        # = --profile web 别名，启动 Web UI
dsh --profile headless "任务"   # 一次性运行器，无服务器
dsh --profile <name>           # 任意具名 profile（$DSH_HOME/profiles/<name>）
dsh plugin --profile <name> <pnpm args>
dsh --profile web --dump-config   # 打印实际组合树
```

分层顺序：bundles（`dsh.profile.bundles` 顺序）→ profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays。launcher 只解析自身 flags，其余交给 booted profile。`headless` 的核心执行能力是 Code Mode worker：任务作为普通用户消息提交，等 quiescence、flush Session、stdout 打印最后非空 assistant 文本、经 `ctx.appExit` 退出（`turn/end` completed → 0，否则 1）。

## Python SDK

`deepseek-harness-sdk`（模块 `deepseek_harness`）：

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run("Inspect the repository and fix the failing tests.", session_id="example-001")
print(result.final_response)
```

* `DeepSeekHarness` context manager **懒启动 bundled 运行时**（`deepseek-harness-runtime-bin` 平台 wheel），持续复用直至退出——不需要系统 Node.js
* 复用同一个 harness 与 session id 会保留该会话拥有的 Bash 进程（工作目录、导出的变量、shell 函数）
* `Session.run()` → `RunResult(session_id, final_response, finish_reason, events, notifications, session_root)`
* 继承 `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` 环境变量

## 选择指南

| 场景 | 入口 |
|---|---|
| 人在浏览器里用 | `dsh web`（Web UI） |
| CI/CD 一次性任务 | `dsh --profile headless "任务"` |
| 从 TypeScript 程序驱动 | JSON-RPC SDK（`dsh-sdk-client`） |
| 从 Python 程序驱动 | `deepseek-harness-sdk` |
| 自动化客户端（MCP 之外的 agent 协议） | ACP 服务器（`dsh-acp`） |
