# Web UI：浏览器中的控制台

> DeepSeek Harness 的默认交互面：`dsh web` 启动的浏览器应用。从模型配置、工作区选择到会话输入与审批弹窗——agent 能力在浏览器中的完整呈现。

## 启动

```sh
npx @deepseek-ai/dsh web
```

默认地址 `http://127.0.0.1:3080`。`dsh` 进程会把**启动时所在的目录**作为默认文件系统位置；全新的 Web UI 不会选中任何工作区，你需要添加一个。

## 三个起步步骤

### 1. 配置模型

打开**设置 → 模型**，输入 [DeepSeek API 密钥](https://platform.deepseek.com/)并保存。模型路由会立即可用，**不需要重启服务器**。

密钥是只写的：保存后页面只收到脱敏描述符，明文密钥存储在 `$DSH_HOME/.credentials.yaml`，settings 只保留它的凭据引用。

### 2. 选择工作区

点击**选择工作区**，添加启动 `dsh` 时所在的项目目录，然后选中它。选中工作区前，会话输入框不可用。

### 3. 运行任务

启动一个会话并发送：

> Summarize this repository and identify its main packages.

Agent 可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要审批，Web UI 会先询问你。

## 界面背后的机制

Web UI 不是"另一个产品"——它是同一棵插件树上的一个组合层：

```text
dsh-base（基础能力）
  └─ dsh-web-app（浏览器 surface bundle）
       ├─ coding persona（提示词段）
       ├─ Web host 行：webserver、API gateway、workspace、projection cache、storage
       ├─ 客户端插件 roster（client 插件在浏览器端运行）
       └─ dsh-client-hmr（开发期热更新）
```

* 浏览器通过 **Typert RPC 网关**（`ctx.remote`）调用 host 服务——`Agent` 等复杂对象映射为 wire identity
* UI 渲染从 `session/event` 与 `session.status` 驱动：会话事件流 → 消息列表、工具卡片、todo 检查清单
* 工具卡片来自 `presentCall`/`presentResult` 的渲染意图（`generic`/`terminal`/`diff`/`search`/`read`/`web`）——工具描述自身，UI 投影为视图

## 审批弹窗

当操作需要审批时，Web UI 作为应答者链的一环呈现确认：

* `tools/pre-execute` 返回 `ask` → `ctx.approval.request` → UI 弹窗
* `allowed-once` 仅授权这一个操作；拒绝/取消/不可用都按拒绝处理
* 审批状态变化会作为运行时上下文快照追加到保留历史之后——模型知道自己处于什么权限环境（见[审批模型](../safety/permission-model.md)）

## 服务器注意事项

`dsh-host-webserver` 是浏览器 GUI 的 `node:http` 载体：具名路由（`exact`/`prefix`）+ 单所有者 fallback 席位 + `tapIndex` 转换。Config `{ host: '127.0.0.1' | '0.0.0.0', port }`——**无 TLS/认证/origin 策略**，绑定 `0.0.0.0` 即暴露网络；`web-startup` provider 会**拒绝 `--host 0.0.0.0`**（不支持的用例）。`EADDRINUSE` 使启动失败。

## 下一步

* [配置模型提供方](../features/providers.md)：目录提供方、自定义 OpenAI 兼容端点、图片输入
* [使用 Python SDK](../extensibility/sdk.md)：程序化接入同一套能力
* [开发插件](../extensibility/plugins.md)：给 Web UI 添加自己的工具与设置卡片
