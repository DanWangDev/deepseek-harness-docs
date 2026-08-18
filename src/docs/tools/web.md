# Web 访问：搜索与抓取

> Web 访问 seam 在同一个 `ctx.web` 服务上横跨**两项操作**（search 与 fetch）：模型提交一个查询，提供方返回规范化的来源列表或抓取正文——更换后端不改变模型与工具之间的契约。

## 为什么一项能力包含两项操作

搜索与抓取既不共享请求 schema，也不共享业务逻辑，但它们被有意设计为同一个 `ctx.web` 中间层：

* 一个提供方选择策略的所有者
* 一套中止与错误词汇
* 一个面向产品的"此 harness 如何访问 Web"配置界面

提供方注册的是**能力**（`WebSearchProvider` 或 `WebFetchProvider`），而非工具；面向模型的名称、schema、提示词引导与展示全部集中在唯一的消费方 `dsh-tool-web` 中。

## 能力拆解

| 角色 | 包 | 说明 |
|---|---|---|
| Service Definition | `dsh-web` | `ctx.web` + 提供方注册表 |
| Service Provider | `dsh-web-search-exa` / `dsh-web-search-perplexity` / `dsh-web-search-deepseek` / `dsh-web-fetch-http` | 三个搜索后端 + 一个抓取后端 |
| Consumer | `dsh-tool-web` | `web_search` / `web_fetch` 工具 schema |

## 搜索请求与结果

面向模型的工具参数**仅为一个 `query`**；`maxResults` 是消费方自有的上限（`searchMaxResults` 配置，默认 `8`），通过 seam 传递并在返回时强制执行——如果提供方返回超量，seam 截断 `sources[]` 并设置 `truncated`。

```text
模型: web_search("DeepSeek Harness 是什么")
  → ctx.web.searchX({ query, maxResults: 8 })   ← 选中的提供方
  → 规范化结果 { content?, sources[], truncated }
  → web 卡片（kind: 'search'）：结构化 sources + 可选 answer
```

```ts
/** Normalized search outcome. */
interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's maxResults. */
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor maxResults. */
  readonly truncated: boolean
}
```

来源始终有 `url`；`title`、`snippet`、`publishedAt` 是可选的——因为不是每个提供方都返回它们（Perplexity 的引用可能只有 URL），**强制适配器发明字段会让 seam 撒谎**。`dsh-tool-web` 渲染 `title ?? hostname(url)` 用于显示。

## 抓取请求与结果

```ts
/** What one fetch-capable backend is asked to retrieve. */
interface WebFetchRequest {
  readonly url: string
}
```

请求**刻意省略**超时、格式、提示与抽取控制：取消是直接的执行参数，展示与高层 LLM 关注点属于安全检索之外。

**HTTP 状态码是资源状态的一部分，不自动视为失败**：即使一次成功的网络抓取收到 `404` 或 `500`，也仍产出一个 `WebFetchResult`（状态码 + 长度受限的已解码正文）。`url` 是经过允许的重定向后的最终 URL。`WebError` 仅用于无法安全获取或表示资源的情况。

## 中止与错误词汇

`ctx.web` 拥有统一的错误与中止词汇：取消信号直接传播给提供方；`WebError` 区分无法安全检索（网络失败、非法 URL）与业务失败（资源不存在）。查询被中止时返回结构化错误而非部分结果。

## 展示：web 卡片

完成的 web 检索以 `{ card: 'web', kind: 'search' | 'fetch', … }` 渲染意图呈现：

| kind | 字段 | 回退 |
|---|---|---|
| `search` | 结构化 `sources` / `answer?` / `truncated` | 不具备 web 能力的 UI 回退到原始结果内容 |
| `fetch` | `url` / `statusCode` / `truncated` | 同上 |

正文不会重复进视图——有能力的 UI 直接渲染结构化来源列表，其余 UI 使用原始内容。

## 工具 schema 要点

| 工具 | 行为 |
|---|---|
| `web_search` | 搜索 Web 并返回可引用来源列表 |
| `web_fetch` | 抓取单个 URL 并返回状态码与受限正文 |

两个工具都把提供方选择置于 `ctx.web` 之后，使模型可见 schema 在更换后端时保持稳定——这是能力 seam 的又一实例。
