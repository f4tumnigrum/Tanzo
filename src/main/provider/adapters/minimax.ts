import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { TanzoValidationError } from '@shared/errors'
import type { Credentials } from '../adapter-types'
import { ensureUrlProtocol, fetchJson, idOnlyModelListSchema } from '../http'
import type { ProviderAdapter } from '../adapter-types'
import { bearer, credentialText, mapIdModels, testByFetching, TIMEOUTS } from '../adapter-utils'

const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'

function minimaxBaseUrl(credentials: Credentials): string {
  return ensureUrlProtocol(credentials.baseUrl, MINIMAX_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function minimaxProvider(credentials: Credentials) {
  const apiKey = credentialText(credentials.apiKey)
  return createOpenAICompatible({
    name: 'minimax',
    baseURL: minimaxBaseUrl(credentials),
    ...(apiKey ? { apiKey } : {})
  })
}

export const minimaxAdapter: ProviderAdapter = {
  providerId: 'minimax',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return minimaxProvider(credentials).chatModel(modelId)
  },
  async fetchModels(credentials, family) {
    if (family !== 'language') return []
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'minimax', missing: 'apiKey' }
        }
      )
    const data = await fetchJson(
      `${minimaxBaseUrl(credentials)}/models`,
      (value) => idOnlyModelListSchema.parse(value),
      {
        timeout: TIMEOUTS.MODEL_FETCH,
        headers: bearer(credentials.apiKey)
      }
    )
    return mapIdModels(data.data, family, 'MiniMax model')
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
