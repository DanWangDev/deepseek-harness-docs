# Web Access: Search and Fetch

> The web access seam spans **two operations** (search and fetch) on the same `ctx.web` service: the model submits a query, and the provider returns a normalized source list or fetched body — swapping backends does not change the contract between model and tools.

## Why One Capability Contains Two Operations

Search and fetch share neither request schema nor business logic, yet they are deliberately designed into the same `ctx.web` middle layer:

* One owner of provider-selection policy
* One abort and error vocabulary
* One product-facing "how this harness accesses the Web" configuration surface

Providers register **capabilities** (`WebSearchProvider` or `WebFetchProvider`), not tools; the model-facing names, schemas, prompt guidance, and presentation all live in the single consumer `dsh-tool-web`.

## Capability Breakdown

| Role | Package | Description |
|---|---|---|
| Service Definition | `dsh-web` | `ctx.web` + provider registry |
| Service Provider | `dsh-web-search-exa` / `dsh-web-search-perplexity` / `dsh-web-search-deepseek` / `dsh-web-fetch-http` | three search backends + one fetch backend |
| Consumer | `dsh-tool-web` | `web_search` / `web_fetch` tool schemas |

## Search Request and Result

The model-facing tool parameter is **only a `query`**; `maxResults` is the consumer's own cap (the `searchMaxResults` config, default `8`), passed through the seam and enforced on return — if a provider returns more, the seam truncates `sources[]` and sets `truncated`.

```text
Model: web_search("What is DeepSeek Harness")
  → ctx.web.searchX({ query, maxResults: 8 })   ← the selected provider
  → normalized result { content?, sources[], truncated }
  → web card (kind: 'search'): structured sources + optional answer
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

Sources always have `url`; `title`, `snippet`, and `publishedAt` are optional — because not every provider returns them (Perplexity's citations may be URLs only), and **forcing an adapter to invent fields would make the seam lie**. `dsh-tool-web` renders `title ?? hostname(url)` for display.

## Fetch Request and Result

```ts
/** What one fetch-capable backend is asked to retrieve. */
interface WebFetchRequest {
  readonly url: string
}
```

The request **deliberately omits** timeouts, formats, prompts, and extraction controls: cancellation is a direct execution parameter, and presentation plus high-level LLM concerns lie outside safe retrieval.

**An HTTP status code is part of the resource's state and is not automatically a failure**: even a successful network fetch that receives `404` or `500` still produces a `WebFetchResult` (status code + length-limited decoded body). `url` is the final URL after allowed redirects. `WebError` is reserved for resources that cannot be fetched or represented safely.

## Abort and Error Vocabulary

`ctx.web` owns a unified error and abort vocabulary: cancellation signals propagate directly to providers; `WebError` distinguishes cannot-retrieve-safely (network failure, invalid URL) from business failure (resource does not exist). An aborted query returns a structured error rather than partial results.

## Presentation: The web Card

A completed web retrieval is presented with the `{ card: 'web', kind: 'search' | 'fetch', … }` render intent:

| kind | Fields | Fallback |
|---|---|---|
| `search` | structured `sources` / `answer?` / `truncated` | UIs without web capability fall back to the raw result content |
| `fetch` | `url` / `statusCode` / `truncated` | same as above |

The body is not duplicated into the view — capable UIs render the structured source list directly; the rest use the raw content.

## Tool Schema Highlights

| Tool | Behavior |
|---|---|
| `web_search` | Searches the Web and returns a list of citable sources |
| `web_fetch` | Fetches a single URL and returns the status code and a length-limited body |

Both tools keep provider selection behind `ctx.web`, so the model-visible schema stays stable when backends are swapped — another instance of the capability seam.
