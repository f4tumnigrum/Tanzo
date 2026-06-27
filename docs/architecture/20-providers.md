# 20 · 供应商运行时

> 适用范围：`ProviderRuntime`、五家适配器、模型解析、凭证与密钥安全、Provider Options。最后核对：`src/main/provider/*`、`src/shared/provider.ts`。

## 1. 模块结构

`module.ts`：`createProviderStore(db)` + `createProviderService(store, createSecretCodec())` → `registerProviderIpc(ipcMain, service)`。service 内部构造 `ProviderRuntime`（`runtime.ts`）并委派给按供应商分的适配器：注册表在 `adapter.ts`（`ADAPTERS`/`getAdapter`），五家实现在 `adapters/<provider>.ts`。

## 2. ProviderRuntime（`runtime.ts:7`）

```ts
interface ProviderRuntime {
  resolveLanguageModel(modelRef: string): LanguageModel
  invalidate(providerId?: ProviderId): void
}
createProviderRuntime(deps: { loadCredentials(providerId, keyId?): Credentials })
```

### 2.1 模型解析管线（config → ai-sdk LanguageModel）

1. `modelRef` 是规范字符串 `"<providerId>:<modelId>"`（如 `anthropic:claude-...`）。`parseModelRef`（`runtime.ts:27`）校验前缀属于 `PROVIDER_IDS` 且 modelId 非空，否则 `PROVIDER_MODEL_REF_INVALID`。
2. service 入口 `resolveLanguageModel`（`service.ts:912`）先 `ensureUsableLanguageModel`（调用点 `service.ts:921`，定义 `service.ts:623`）：模型须存在于 `provider_models`（family `language`）且 `enabled`，否则 `PROVIDER_MODEL_NOT_FOUND` / `PROVIDER_MODEL_DISABLED`。
3. runtime 调 `loadCredentials(providerId)` → `getAdapter(providerId).createLanguageModel(modelId, credentials)`。
4. 结果经 `wrapLanguageModel({ model, middleware: MIDDLEWARE })`（当前 `MIDDLEWARE` 为空）。
5. **缓存不变量**：LRU 键 `[providerId, modelId, credentialFingerprint]`（`\u001f` 连接）。`credentialFingerprint` 是凭证条目排序后的 sha256。上限 32 条。`invalidate(providerId?)` 按前缀或全量清除——key 变更/删除/激活时由 service 调用。

## 3. 适配器模式（`adapter-types.ts:27`）

```ts
interface ProviderAdapter {
  providerId: ProviderId
  validateCredentials(credentials): boolean
  createLanguageModel(modelId, credentials): LanguageModel
  createEmbeddingModel?(...)  createImageModel?(...)
  createTranscriptionModel?(...)  createSpeechModel?(...)
  fetchModels(credentials, family): Promise<RemoteModel[]>
  testConnection(credentials): Promise<ConnectionTestResult>
}
```

`Credentials = Record<string, string>`。注册表 `ADAPTERS: Record<ProviderId, ProviderAdapter>`（`adapter.ts:12`），未知 id 抛 `PROVIDER_UNKNOWN`。

五家适配器：

| 适配器 | SDK 工厂 | LanguageModel 调用 | language 外能力 |
|---|---|---|---|
| openai | `createOpenAI` | `provider(modelId)` | embedding/image/transcription/speech |
| anthropic | `createAnthropic` | `provider(modelId)` | 仅 language；分页 `/models` |
| google | `createGoogleGenerativeAI` | `provider(modelId)` | embedding/image；按 `supportedGenerationMethods` 过滤 |
| deepseek | `createDeepSeek` | `.chat(modelId)` | 仅 language |
| openai-compatible | `createOpenAICompatible` | `.chatModel(modelId)` | embedding/image；需 `baseUrl` 而非 apiKey |

共享助手：`adapter-utils.ts`（`bearer`/`credentialText`/`mapIdModels`/`testByFetching`/`TIMEOUTS`）、`http.ts`（`fetchJson`/`ensureUrlProtocol`）、`sse-filter.ts` 的 `filterResponsesApiSseFetch()`（修补 OpenAI Responses-API 畸形 SSE，openai 与 openai-compatible 共用）。

模型元数据：`model-metadata.ts` 抓 `https://models.dev/api.json`（缓存 1h）回填 `contextWindow`/`maxOutput`/能力标志（仅映射 openai/anthropic/google/deepseek）。

## 4. Provider Options（`options.ts` + `options/*.ts`）

- `OPTION_SCHEMAS` 是五家 `ProviderOptionSchema[]` 的并集。每个 `options/<provider>.ts` 声明面向 UI 的 schema，`fields[].path` 是进 ai-sdk `ProviderOptions` 的点路径；含编译期 `_typecheck` 对真实 ai-sdk 选项类型校验。
- `ProviderDefaultsState` 三桶：`callDefaults`、`providerOptions`、`rawProviderOptions`（`shared/provider.ts:215`）。
- `mergeProviderOptions(defaults, providerId, family)`（`options.ts:84`）→ `scopedProviderOptions`：把松散键嵌到正确 `providerKey` 下，再深合并 `rawProviderOptions`（raw 优先）。
- **安全不变量**：`UNSAFE_OPTION_KEYS = {__proto__, constructor, prototype}` 在每次合并/净化时剥离。`canonicalProviderOptionKey` 把 `'openai-compatible'` 映射为 `'openaiCompatible'`。
- service 暴露 `getProviderOptions`、`getCallSettings` 供 agent 运行时使用。

## 5. 凭证与密钥安全

- **静态加密**：`SecretCodec`（`secret.ts:7`）用 Electron `safeStorage`。密文前缀 `safe:`（OS 加密）或 `plain:`（base64 回退，**默认禁用**）。模块用 `createSecretCodec()` 无明文回退——加密不可用时抛 `PROVIDER_SECRET_ENCRYPTION_UNAVAILABLE`。
- **存储表**：API key 存 `provider_keys.encrypted_value`；非 apiKey 密钥字段存 `provider_connections.secret_fields_encrypted_json`；公开字段存 `public_fields_json`。
- **掩码不变量**：密钥绝不以明文跨 IPC。`maskSecret`（`service.ts:76`）只露前 4 字符 + 圆点；`buildConnectionInfo` 掩码表单值；`isMask` 检测掩码提交，重存掩码时保留原值。`ProviderKeySummary` 只带 `maskedKey`。
- 活跃 key 选择：`selectActiveKey` 未设时回落第一把；`loadCredentialSnapshot` 每次使用 touch `lastUsedAt`。

## 6. ProviderService 与通道

`ProviderApi`（`shared/provider.ts:299`）+ 运行时方法（`resolveLanguageModel`/`getModelMetadata`/`getProviderOptions`/`getCallSettings`）。`PROVIDER_CHANNELS`（`shared/provider.ts:1`，前缀 `provider:`），`ipc.ts` 用 zod 校验。

## 7. 供应商不变量

- [ ] `modelRef` = `"<providerId>:<modelId>"`，前缀属于 5 个 `PROVIDER_IDS`。
- [ ] 密钥不以明文跨 IPC；只露 `maskedKey`；存储需 OS `safeStorage`（无明文回退）。
- [ ] LanguageModel 缓存按凭证指纹键；key 变更必须 `invalidate(providerId)`（service 在每次 key 变更时调）。
- [ ] Provider Options 剥离原型污染键；raw 选项深合并时覆盖 scoped。

下一篇 → [21 MCP 集成](./21-mcp.md)
