# Model Providers: Multi-Endpoint Routing

> DeepSeek Harness's model routing: provider registration on the `ctx.llm` adapter seam, configuration of catalog providers and custom providers, credential references and image-input declarations — and how a model change "takes effect on the next request."

## Capability Breakdown

| Role | Package |
|---|---|
| Service Definition | `dsh-llm` (`ctx.llm` + message/streaming vocabulary + adapter seam) |
| Service Provider | `dsh-llm-deepseek` (official endpoint), `dsh-llm-pi-ai` (catalog + custom providers), Anthropic/OpenAI and other adapters under `dsh-llm-pi-ai` |
| Consumer | agent loop (via `agent/request` → `llm/stream`) |

**A model change takes effect on the next request — no server restart needed.**

## Configuring DeepSeek

Open **Settings → Models**: the DeepSeek card offers an API key field; enter and save. Keys are write-only — after saving, the page only receives a desensitized descriptor, the plaintext key is stored in `$DSH_HOME/.credentials.yaml`, and settings keep only the credential reference.

## Adding a Catalog Provider

Select **Add Provider**, pick a provider such as Anthropic or OpenAI, enter the API key, and save. The installed catalog supplies the endpoint, protocol, and model list — **catalog providers use the installed catalog and make no network requests**.

Providers that use native auth need their own native credentials: Bedrock, Vertex, Azure, and Codex use AWS credentials and region, an ADC project, `api-version`, and OAuth respectively; filling in only the API key field cannot complete configuration.

## Adding a Custom Provider

For corporate gateways, self-hosted servers, or providers absent from the installed catalog, select **Add Custom Provider**: provide a lowercase Provider ID, a base URL, an API protocol, credentials, and at least one model.

**The Provider ID is permanent** — requests, saved sessions, model defaults, and credential references all use it. To rename, add a new provider and delete the old one. The display name, base URL, protocol, credentials, and models remain editable.

In **Model Catalog**, select **Fetch Available Models** to query the base URL and credentials currently shown in the form (calling the OpenAI-compatible `GET /models`). Selecting a candidate only updates the draft — the provider is not stored until you save.

## Image Input

Manually entered models are treated as text-only until they declare otherwise — no stage can ask the endpoint which modalities it accepts. Attaching an image to such a model is rejected before sending, naming that model.

Vision models under a custom provider need an `input` added for that model in `$DSH_HOME/settings.yaml`:

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

* `input` accepts `text` and `image` and applies only to that model — one route can serve both kinds of models
* Omitting `input` (or writing an empty list — the two are synonymous) → keeps the modalities recorded in the installed catalog; models the catalog does not describe fall back to the route's `defaultInput` (default `[text]`)
* `defaultInput` is a **fallback value, not an override** — it never strips image capability from a model the catalog already lists as image-capable; to narrow such a model, use its own `input`
* Model overrides for catalog providers live under `modelOverrides`, keyed by model id
* Writing an unknown modality anywhere is rejected

Both fields are **assertions about your endpoint, not checks of it** — a model declared image-capable on an endpoint that does not actually provide it is not stopped here; the provider rejects that request instead.

## Selecting a Model

Configured providers appear in the model selector; selecting a model also sets it as the default for new sessions. **A session that has already sent requests keeps the model recorded in its own log** (`request/header` + `request/context` events). If a saved default points at a deleted provider, the input shows **Select Model** and blocks input until another model is chosen.

## Troubleshooting

| Error | Handling |
|---|---|
| `MISSING_CREDENTIAL` | store the provider key via the model page, or provide the referenced environment variable |
| `UNKNOWN_MODEL` | select a configured model, or add the missing model to the custom provider |
| Fetch available models returns 401 | check the key; for services without `GET /models`, enter models manually |
| Image rejected before sending | the model does not declare image modality; add `input: [text, image]` to the model (DeepSeek's own chat-completions route is text-only and cannot be changed through configuration) |
| Provider rejects a request with an image | the model declares image capability the endpoint does not actually provide; remove the `image` granted to it, then start a new session (attached images stay in the session log) |

## Adapter Contract Points

* Every adapter implements the `StreamChunk` protocol of `llm/stream` (a closed union: `block-start`/`text-delta`/`reasoning-delta`/`tool-call-delta`/`block-end`/`usage`/`finish`)
* Exceptions thrown by adapters are normalized — failed requests recover via `agent/request-error` (returning `{ kind: 'retry' }` retries)
* Capabilities (`SubagentCapabilities`-style capability declarations) register per adapter; `UNKNOWN_MODEL`/`MISSING_CREDENTIAL` are structured errors at the adapter layer
* The routed model's context capacity (`contextWindow`) is recorded via the `request/context` event, for token-budget and compaction decisions (see [Token budget](../context/token-budget.md))
