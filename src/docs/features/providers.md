# 模型提供方：多端点路由

> DeepSeek Harness 的模型路由：`ctx.llm` 适配器 seam 上的提供方注册、目录提供方与自定义提供方的配置、凭据引用与图片输入声明——以及模型变更如何"下一次请求即生效"。

## 能力拆解

| 角色 | 包 |
|---|---|
| Service Definition | `dsh-llm`（`ctx.llm` + 消息/流式词汇 + 适配器 seam） |
| Service Provider | `dsh-llm-deepseek`（官方端点）、`dsh-llm-pi-ai`（目录 + 自定义提供方）、`dsh-llm-pi-ai` 下的 Anthropic/OpenAI 等适配器 |
| Consumer | agent loop（经 `agent/request` → `llm/stream`） |

**模型变更会在下一次请求时生效，不需要重启服务器。**

## 配置 DeepSeek

打开**设置 → 模型**：DeepSeek 卡片提供一个 API 密钥字段，输入并保存。密钥是只写的——保存后页面只收到脱敏描述符，明文密钥存储在 `$DSH_HOME/.credentials.yaml`，settings 只保留凭据引用。

## 添加目录提供方

选择**添加提供方**，选取 Anthropic 或 OpenAI 等提供方，输入 API 密钥并保存。已安装目录会提供端点、协议和模型列表——**目录提供方使用已安装目录，不发起网络请求**。

使用原生认证的提供方需要各自的原生凭据：Bedrock、Vertex、Azure 和 Codex 分别使用 AWS 凭据与区域、ADC 项目、`api-version` 和 OAuth；只填写 API 密钥字段无法完成配置。

## 添加自定义提供方

对于公司网关、自建服务器或已安装目录中不存在的提供方，选择**添加自定义提供方**：提供小写 Provider ID、基础 URL、API 协议、凭据和至少一个模型。

**Provider ID 是永久的**——请求、已保存会话、模型默认值和凭据引用都会使用它。如需重命名，请添加新提供方并删除旧提供方。显示名称、基础 URL、协议、凭据和模型仍可编辑。

在**模型目录**中选择**获取可用模型**，可查询表单当前显示的基础 URL 和凭据（调用 OpenAI 兼容的 `GET /models`）。选择候选项只会更新草稿——保存前不会存储提供方。

## 图片输入

手动输入的模型在自己声明之前一律按纯文本对待——没有任何环节能去询问端点接受哪些模态。给这类模型附加图片，会在发送前就被拒绝，并点名该模型。

自定义提供方下的视觉模型需要在 `$DSH_HOME/settings.yaml` 中给该模型加 `input`：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

* `input` 接受 `text` 和 `image`，且只作用于该模型——一条路由可以同时服务两类模型
* 省略 `input`（或写空列表，两者同义）→ 保留已安装目录记录的模态；目录未描述的模型回退到路由的 `defaultInput`（默认 `[text]`）
* `defaultInput` 是**回退值而不是覆盖值**——绝不会把目录中本就具备图片能力的模型的该能力去掉；要收窄这类模型，请用它自己的 `input`
* 目录提供方的模型覆盖写在 `modelOverrides` 下，以模型 id 为键
* 未知模态在任何位置写入都会被拒绝

这两个字段都是**对你端点的断言，而不是对它的检查**——声明了端点并不提供的图片能力的模型不会在这里被拦下，改由提供方拒绝该请求。

## 选择模型

已配置的提供方出现在模型选择器中；选择模型也会将其设为新会话的默认值。**已发送过请求的会话会保留自身日志中记录的模型**（`request/header` + `request/context` 事件）。如果已保存默认值指向已删除的提供方，输入框会显示**选择模型**，并在选择其他模型前阻止输入。

## 排错

| 错误 | 处理 |
|---|---|
| `MISSING_CREDENTIAL` | 通过模型页存储提供方密钥，或提供被引用的环境变量 |
| `UNKNOWN_MODEL` | 选择已配置的模型，或向自定义提供方添加缺失的模型 |
| 获取可用模型返回 401 | 检查密钥；不提供 `GET /models` 的服务请手动输入模型 |
| 图片在发送前被拒绝 | 该模型未声明图片模态；给模型加 `input: [text, image]`（DeepSeek 自身的 chat-completions 路由是纯文本的，无法通过配置改变） |
| 提供方拒绝了带图片的请求 | 该模型声明了端点实际并不提供的图片能力；移除授予它的 `image`，然后开新会话（附加图片会留在会话日志里） |

## 适配器契约要点

* 每个适配器实现 `llm/stream` 的 `StreamChunk` 协议（封闭联合：`block-start`/`text-delta`/`reasoning-delta`/`tool-call-delta`/`block-end`/`usage`/`finish`）
* 适配器抛出的异常被规范化——失败请求经 `agent/request-error` 恢复（返回 `{ kind: 'retry' }` 即重试）
* 能力（`SubagentCapabilities` 式的能力声明）按适配器注册；`UNKNOWN_MODEL`/`MISSING_CREDENTIAL` 是适配器层的结构化错误
* 模型路由的上下文容量（`contextWindow`）经 `request/context` 事件记录，供 token 预算与压缩决策使用（见[Token 预算](../context/token-budget.md)）
