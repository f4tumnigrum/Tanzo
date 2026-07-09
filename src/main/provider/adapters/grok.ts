import { createXai } from '@ai-sdk/xai'
import { TanzoValidationError } from '@shared/errors'
import type { Credentials } from '../adapter-types'
import { ensureUrlProtocol, fetchJson, idOnlyModelListSchema } from '../http'
import type { ProviderAdapter } from '../adapter-types'
import { bearer, credentialText, mapIdModels, testByFetching, TIMEOUTS } from '../adapter-utils'

const GROK_DEFAULT_BASE_URL = 'https://api.x.ai/v1'

function grokBaseUrl(credentials: Credentials): string {
  const normalized = ensureUrlProtocol(credentials.baseUrl, GROK_DEFAULT_BASE_URL).replace(
    /\/+$/,
    ''
  )
  return normalized === 'https://api.x.ai' ? `${normalized}/v1` : normalized
}

function grokProvider(credentials: Credentials) {
  const apiKey = credentialText(credentials.apiKey)
  return createXai({
    baseURL: grokBaseUrl(credentials),
    ...(apiKey ? { apiKey } : {})
  })
}

export const grokAdapter: ProviderAdapter = {
  providerId: 'grok',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return grokProvider(credentials).responses(modelId)
  },
  async fetchModels(credentials, family) {
    if (family !== 'language') return []
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'grok', missing: 'apiKey' }
        }
      )
    const data = await fetchJson(
      `${grokBaseUrl(credentials)}/models`,
      (value) => idOnlyModelListSchema.parse(value),
      {
        timeout: TIMEOUTS.MODEL_FETCH,
        headers: bearer(credentials.apiKey)
      }
    )
    return mapIdModels(data.data, family, 'Grok model')
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
