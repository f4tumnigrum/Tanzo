# 20 · 供应商运行时

> 适用范围：`ProviderRuntime`、五家适配器、模型解析、凭证与密钥安全、Provider Options、SSE 过滤。最后核对：`src/main/provider/*` 与 `src/shared/provider.ts`（v0.2.4）。

## 1. 适配器注册表

五家适配器注册在一个编译期 record（`provider/adapter.ts:12-18`）：

```ts
ADAPTERS = {
  openai:              openaiAdapter,
  anthropic:           anthropicAdapter,
  google:              googleAdapter,
  deepseek:            deepseekAdapter,
  'openai-compatible': openaiCompatibleAdapter
}
```

`getAdapter(providerId)` 直接查表，未知 id 抛 `TanzoNotFoundError('PROVIDER_UNKNOWN')`（`adapter.ts:20-27`）。`ProviderAdapter`（`adapter-types.ts:27-36`）须实现 `validateCredentials`、`createLanguageModel(modelId, credentials)`（返回 Vercel AI SDK 的 `LanguageModel`）、`fetchModels`、`testConnection`，另有可选的 embedding/image/transcription/speech 工厂。

按适配器的 SDK 实例化：

| 适配器 | SDK 包 | 工厂 |
|---|---|---|
| openai | `@ai-sdk/openai` | `createOpenAI(…)(modelId)` |
| anthropic | `@ai-sdk/anthropic` | `createAnthropic(…)(modelId)` |
| google | `@ai-sdk/google` | `createGoogleGenerativeAI(…)(modelId)` |
| deepseek | `@ai-sdk/deepseek` | `createDeepSeek(…).chat(modelId)` |
| openai-compatible | `@ai-sdk/openai-compatible` | `createOpenAICompatible(…).chatModel(modelId)` |

## 2. `ProviderRuntime`

`createProviderRuntime(deps)`（`provider/runtime.ts:44-87`）暴露 `{ resolveLanguageModel(modelRef), invalidate(providerId?) }`，并保持一个上限 32 项的 LRU 缓存。缓存键为 `providerId ⟶ modelId ⟶ credentialFingerprint`（对排序凭证对的 SHA-256）。未命中时调 `getAdapter(providerId).createLanguageModel(modelId, credentials)`，并用 `wrapLanguageModel({ model, middleware: MIDDLEWARE })` 包裹（`MIDDLEWARE` 当前为空）。`invalidate` 清全部或仅某供应商项（密钥/模型变更时调用）。

runtime 在 `ProviderService` 内创建，由后者提供 `loadCredentials`；模块（`provider/module.ts:21-39`）接线 `ProviderStore`（SQLite）→ `ProviderService(store, createSecretCodec())`。

## 3. 模型 id 解析

模型 ref 为 `"providerId:modelId"`，在首个冒号切分。规范供应商 id 为 `['openai', 'anthropic', 'google', 'deepseek', 'openai-compatible']`（`src/shared/provider.ts`）。

`parseModelRef`（`runtime.ts:27-42`）对照 `PROVIDER_IDS` 校验前缀并要求非空 model id（失败抛 `PROVIDER_MODEL_REF_INVALID`）。`ProviderService.resolveLanguageModel` 的完整路径：

1. `parseModelRef(modelRef)`。
2. `ensureUsableLanguageModel(providerId, modelId)` —— 查 `provider_models` 表；缺失抛 `PROVIDER_MODEL_NOT_FOUND`，禁用抛 `PROVIDER_MODEL_DISABLED`。
3. 委托 `runtime.resolveLanguageModel(modelRef)` → 缓存或创建。

## 4. 凭证 / 密钥安全

密钥由 `SecretCodec`（`provider/secret.ts`）处理，构建于 Electron `safeStorage`：

- `encrypt(plaintext)`：`safeStorage.isEncryptionAvailable()` 时存为 `safe:` + `safeStorage.encryptString(...)` 的 base64；否则仅当 `allowPlaintextFallback`（默认 `false`）时存为 `plain:` + base64，再否则抛 `PROVIDER_SECRET_ENCRYPTION_UNAVAILABLE`。
- `decrypt(ciphertext)`：`safe:` → `safeStorage.decryptString`；`plain:` → base64 解码；否则抛。

加密串存入 SQLite（`provider_keys.encrypted_value`、`provider_connections`）；只持久化加密值。

**密钥绝不以明文跨 IPC**——这是强制而非偶然：

- `maskSecret(value)` 与 `maskEncryptedSecret(codec, ciphertext)`（`service.ts`）在主进程解密、打码，只返回打码形态。
- `buildConnectionInfo` 恒向 renderer 发打码 `formValues`；`keySummary` 返回 `maskedKey` 为打码的 `ProviderKeySummary`。
- `decryptCredentials()` 仅在主进程 `loadCredentials()` 内调用；解密后的 `Credentials` 对象被适配器工厂消费，绝不序列化进任何 IPC 返回值。
- `provider/ipc.ts` 的 IPC handlers 返回 `ProviderWorkspace`、`ProviderKeySummary[]`、`ModelRefreshResult`……全为打码，绝无原始密钥。

详见 [50 横切关注点](./50-cross-cutting.md)。

## 5. Provider Options

`ProviderDefaultsState`（`src/shared/provider.ts`）有三桶：

- `callDefaults` —— 原始调用设置（temperature、max tokens……），由 `getCallSettings(providerId, family)` 直接返回。
- `providerOptions` —— 合并时作用域到供应商键。
- `rawProviderOptions` —— 逐字合并（绕过作用域）。

`mergeProviderOptions(defaults, providerId, family)`（`provider/options.ts`）把匹配已知 schema `providerKey` 的字段路由进该命名空间，深合并 `rawProviderOptions`，并防原型污染（`UNSAFE_OPTION_KEYS = { __proto__, constructor, prototype }`）。按供应商的 option schema 在 `provider/options/*.ts`（如 anthropic `thinking.budgetTokens`、openai `reasoningEffort`、google `thinkingConfig`）。`'openai-compatible'` 键规范化为 `'openaiCompatible'`。

## 6. SSE 过滤（`provider/sse-filter.ts`）

`filterResponsesApiSseFetch(baseFetch)` 包裹 openai 与 openai-compatible 适配器所用 fetch，**仅**对以 `/responses` 结尾的 URL（OpenAI Responses API）生效：

- **非流式 JSON**：规范化 body——合成缺失的 `output` 项 id，补默认 `annotations` / `summary` 数组。
- **流式 SSE**：缓冲字节流、按帧界切分，保留 `type` 以 `response.` 开头或等于 `error` 的帧，丢弃其余。

原因：SDK 的 OpenAI 适配器为 Chat Completions 流式而写；Responses API 发命名事件类型及 SDK 不预期的字段。该过滤移除不兼容帧使解析器不噎住，并补齐必需字段。

下一篇 → [21 MCP 集成](./21-mcp.md)
