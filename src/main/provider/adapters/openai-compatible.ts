import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { TanzoValidationError } from '@shared/errors'
import { ensureUrlProtocol, fetchJson, formatModelName, idOnlyModelListSchema } from '../http'
import type { Credentials, ProviderAdapter } from '../adapter-types'
import {
  bearer,
  credentialText,
  modelLooksLikeFamily,
  testByFetching,
  TIMEOUTS
} from '../adapter-utils'
import { filterResponsesApiSseFetch } from '../sse-filter'

function compatibleBaseUrl(credentials: Credentials): string {
  const normalized = ensureUrlProtocol(credentials.baseUrl, 'http://localhost:11434/v1').replace(
    /\/+$/,
    ''
  )
  if (normalized.endsWith('/api')) return `${normalized.slice(0, -4)}/v1`
  try {
    const url = new URL(normalized)
    if (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.port === '11434' &&
      (url.pathname === '' || url.pathname === '/')
    ) {
      return `${normalized}/v1`
    }
  } catch {
    // ensureUrlProtocol already normalizes ordinary user input; leave unusual URLs unchanged.
  }
  return normalized
}

function openaiCompatibleProvider(credentials: Credentials) {
  const apiKey = credentialText(credentials.apiKey)
  return createOpenAICompatible({
    name: credentialText(credentials.name) ?? 'openai-compatible',
    baseURL: compatibleBaseUrl(credentials),
    fetch: filterResponsesApiSseFetch(),
    ...(apiKey ? { apiKey } : {})
  })
}

export const openaiCompatibleAdapter: ProviderAdapter = {
  providerId: 'openai-compatible',
  validateCredentials: (credentials) => Boolean(credentials.baseUrl?.trim()),
  createLanguageModel(modelId, credentials) {
    return openaiCompatibleProvider(credentials).chatModel(modelId)
  },
  createEmbeddingModel(modelId, credentials) {
    return openaiCompatibleProvider(credentials).embeddingModel(modelId)
  },
  createImageModel(modelId, credentials) {
    return openaiCompatibleProvider(credentials).imageModel(modelId)
  },
  async fetchModels(credentials, family) {
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: baseUrl',
        {
          details: { providerId: 'openai-compatible', missing: 'baseUrl' }
        }
      )
    if (family === 'transcription' || family === 'speech') return []
    const data = await fetchJson(
      `${compatibleBaseUrl(credentials)}/models`,
      (value) => idOnlyModelListSchema.parse(value),
      {
        timeout: TIMEOUTS.MODEL_FETCH,
        ...(credentials.apiKey ? { headers: bearer(credentials.apiKey) } : {})
      }
    )
    return data.data
      .filter((model) => modelLooksLikeFamily(model.id, family))
      .map((model) => ({
        id: model.id,
        name: formatModelName(model.id),
        description: model.owned_by ? `Owned by ${model.owned_by}` : 'OpenAI-compatible model'
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
