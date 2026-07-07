import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { TanzoValidationError } from '@shared/errors'
import type { Credentials } from '../adapter-types'
import { ensureUrlProtocol, fetchJson, idOnlyModelListSchema } from '../http'
import type { ProviderAdapter } from '../adapter-types'
import { bearer, credentialText, mapIdModels, testByFetching, TIMEOUTS } from '../adapter-utils'

const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

function zhipuBaseUrl(credentials: Credentials): string {
  return ensureUrlProtocol(credentials.baseUrl, ZHIPU_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function zhipuProvider(credentials: Credentials) {
  const apiKey = credentialText(credentials.apiKey)
  return createOpenAICompatible({
    name: 'zhipu',
    baseURL: zhipuBaseUrl(credentials),
    ...(apiKey ? { apiKey } : {})
  })
}

export const zhipuAdapter: ProviderAdapter = {
  providerId: 'zhipu',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return zhipuProvider(credentials).chatModel(modelId)
  },
  createEmbeddingModel(modelId, credentials) {
    return zhipuProvider(credentials).embeddingModel(modelId)
  },
  createImageModel(modelId, credentials) {
    return zhipuProvider(credentials).imageModel(modelId)
  },
  async fetchModels(credentials, family) {
    if (family === 'transcription' || family === 'speech') return []
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'zhipu', missing: 'apiKey' }
        }
      )
    const data = await fetchJson(
      `${zhipuBaseUrl(credentials)}/models`,
      (value) => idOnlyModelListSchema.parse(value),
      {
        timeout: TIMEOUTS.MODEL_FETCH,
        headers: bearer(credentials.apiKey)
      }
    )
    return mapIdModels(data.data, family, 'Zhipu model')
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
