# 20 · Providers

> Scope: `ProviderRuntime`, the five adapters, model resolution, credential/secret security, provider options,
> and SSE filtering. Last verified against `src/main/provider/*` and `src/shared/provider.ts` at v0.2.4.

## 1. The adapter registry

All five adapters are registered in a compile-time record (`provider/adapter.ts:12-18`):

```ts
ADAPTERS = {
  openai:              openaiAdapter,
  anthropic:           anthropicAdapter,
  google:              googleAdapter,
  deepseek:            deepseekAdapter,
  'openai-compatible': openaiCompatibleAdapter
}
```

`getAdapter(providerId)` does a direct lookup and throws `TanzoNotFoundError('PROVIDER_UNKNOWN')` for unknown
ids (`adapter.ts:20-27`). A `ProviderAdapter` (`adapter-types.ts:27-36`) must implement
`validateCredentials`, `createLanguageModel(modelId, credentials)` (returning a Vercel AI SDK `LanguageModel`),
`fetchModels`, and `testConnection`, with optional embedding/image/transcription/speech factories.

Per-adapter SDK instantiation:

| Adapter | SDK package | Factory |
|---|---|---|
| openai | `@ai-sdk/openai` | `createOpenAI(…)(modelId)` |
| anthropic | `@ai-sdk/anthropic` | `createAnthropic(…)(modelId)` |
| google | `@ai-sdk/google` | `createGoogleGenerativeAI(…)(modelId)` |
| deepseek | `@ai-sdk/deepseek` | `createDeepSeek(…).chat(modelId)` |
| openai-compatible | `@ai-sdk/openai-compatible` | `createOpenAICompatible(…).chatModel(modelId)` |

## 2. `ProviderRuntime`

`createProviderRuntime(deps)` (`provider/runtime.ts:44-87`) exposes
`{ resolveLanguageModel(modelRef), invalidate(providerId?) }` and keeps an LRU cache capped at 32 entries. The
cache key is `providerId ⟶ modelId ⟶ credentialFingerprint` (a SHA-256 over sorted credential pairs). On a
miss it calls `getAdapter(providerId).createLanguageModel(modelId, credentials)` and wraps the result with
`wrapLanguageModel({ model, middleware: MIDDLEWARE })` (`MIDDLEWARE` is currently empty). `invalidate` clears
all entries or only those for one provider (called when keys/models change).

The runtime is created inside `ProviderService`, which supplies `loadCredentials`; the module
(`provider/module.ts:21-39`) wires `ProviderStore` (SQLite) → `ProviderService(store, createSecretCodec())`.

## 3. Model-id resolution

A model ref is `"providerId:modelId"`, split at the first colon. The canonical provider ids are
`['openai', 'anthropic', 'google', 'deepseek', 'openai-compatible']` (`src/shared/provider.ts`).

`parseModelRef` (`runtime.ts:27-42`) validates the prefix against `PROVIDER_IDS` and requires a non-empty model
id (throwing `PROVIDER_MODEL_REF_INVALID` on failure). The full path in `ProviderService.resolveLanguageModel`:

1. `parseModelRef(modelRef)`.
2. `ensureUsableLanguageModel(providerId, modelId)` — queries the `provider_models` table; throws
   `PROVIDER_MODEL_NOT_FOUND` if missing or `PROVIDER_MODEL_DISABLED` if disabled.
3. Delegates to `runtime.resolveLanguageModel(modelRef)` → cache-or-create.

## 4. Credential / secret security

Secrets are handled by a `SecretCodec` (`provider/secret.ts`) built from Electron `safeStorage`:

- `encrypt(plaintext)`: if `safeStorage.isEncryptionAvailable()`, store as `safe:` + base64 of
  `safeStorage.encryptString(...)`. Otherwise, only if `allowPlaintextFallback` (default `false`), store as
  `plain:` + base64; else throw `PROVIDER_SECRET_ENCRYPTION_UNAVAILABLE`.
- `decrypt(ciphertext)`: `safe:` → `safeStorage.decryptString`; `plain:` → base64 decode; otherwise throw.

The encrypted string is stored in SQLite (`provider_keys.encrypted_value`, `provider_connections`); only
encrypted values are persisted.

**Keys never cross IPC in plaintext** — this is enforced, not incidental:

- `maskSecret(value)` and `maskEncryptedSecret(codec, ciphertext)` (`service.ts`) decrypt on the main process,
  mask, and return only the masked form.
- `buildConnectionInfo` always sends masked `formValues` to the renderer; `keySummary` returns a
  `ProviderKeySummary` whose `maskedKey` is the mask.
- `decryptCredentials()` is called only inside the main-process `loadCredentials()`; the decrypted `Credentials`
  object is consumed by adapter factories and is never serialized into any IPC return value.
- The IPC handlers in `provider/ipc.ts` return `ProviderWorkspace`, `ProviderKeySummary[]`, `ModelRefreshResult`,
  … — all masked, never raw keys.

See [50 Cross-Cutting](./50-cross-cutting.md).

## 5. Provider options

`ProviderDefaultsState` (`src/shared/provider.ts`) has three buckets:

- `callDefaults` — raw call settings (temperature, max tokens, …), returned directly by
  `getCallSettings(providerId, family)`.
- `providerOptions` — scoped to the provider key during merge.
- `rawProviderOptions` — merged verbatim (bypasses scoping).

`mergeProviderOptions(defaults, providerId, family)` (`provider/options.ts`) routes fields that match a known
schema `providerKey` into that namespace, deep-merges `rawProviderOptions`, and guards against prototype
pollution (`UNSAFE_OPTION_KEYS = { __proto__, constructor, prototype }`). Per-provider option schemas live in
`provider/options/*.ts` (e.g. anthropic `thinking.budgetTokens`, openai `reasoningEffort`, google
`thinkingConfig`). The `'openai-compatible'` key is canonicalized to `'openaiCompatible'`.

## 6. SSE filtering (`provider/sse-filter.ts`)

`filterResponsesApiSseFetch(baseFetch)` wraps the fetch used by the openai and openai-compatible adapters, and
applies **only** to URLs ending in `/responses` (the OpenAI Responses API):

- **Non-streaming JSON**: normalizes the body — synthesizes missing `output` item ids, defaults missing
  `annotations` / `summary` arrays.
- **Streaming SSE**: buffers the byte stream, splits on frame boundaries, keeps frames whose `type` begins with
  `response.` or equals `error`, and drops everything else.

Why: the SDK's OpenAI adapter was written for Chat Completions streaming; the Responses API emits named event
types plus fields the SDK does not expect. The filter removes incompatible frames so the parser does not choke,
and fills in required fields.

Next → [21 MCP](./21-mcp.md)
