import { createOpenAI } from '@ai-sdk/openai'
import { TanzoValidationError } from '@shared/errors'
import {
  buildHeaders,
  ensureUrlProtocol,
  fetchJson,
  formatModelName,
  idOnlyModelListSchema
} from '../http'
import type { Credentials, ProviderAdapter } from '../adapter-types'
import {
  bearer,
  credentialText,
  mapIdModels,
  modelLooksLikeFamily,
  testByFetching,
  TIMEOUTS
} from '../adapter-utils'
import { filterResponsesApiSseFetch } from '../sse-filter'

function openaiBaseUrl(credentials: Credentials): string {
  const normalized = ensureUrlProtocol(credentials.baseUrl, 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  )
  if (normalized === 'https://api.openai.com') return 'https://api.openai.com/v1'
  if (normalized.endsWith('/openai')) return `${normalized}/v1`
  return normalized
}

function openaiProvider(credentials: Credentials) {
  const organization = credentialText(credentials.organization)
  const project = credentialText(credentials.project)
  return createOpenAI({
    apiKey: credentialText(credentials.apiKey),
    baseURL: openaiBaseUrl(credentials),
    fetch: filterResponsesApiSseFetch(),
    ...(organization ? { organization } : {}),
    ...(project ? { project } : {})
  })
}

function isResponsesModel(id: string): boolean {
  const normalized = id.toLowerCase()
  return (
    !normalized.includes('moderation') &&
    !normalized.includes('instruct') &&
    !normalized.includes('babbage') &&
    !normalized.includes('davinci')
  )
}

function embeddingDimensions(id: string): number | undefined {
  if (id.includes('text-embedding-3-large')) return 3072
  if (id.includes('text-embedding-3-small') || id.includes('text-embedding-ada-002')) return 1536
  return undefined
}

export const openaiAdapter: ProviderAdapter = {
  providerId: 'openai',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return openaiProvider(credentials)(modelId)
  },
  createEmbeddingModel(modelId, credentials) {
    return openaiProvider(credentials).embedding(modelId)
  },
  createImageModel(modelId, credentials) {
    return openaiProvider(credentials).image(modelId)
  },
  createTranscriptionModel(modelId, credentials) {
    return openaiProvider(credentials).transcription(modelId)
  },
  createSpeechModel(modelId, credentials) {
    return openaiProvider(credentials).speech(modelId)
  },
  async fetchModels(credentials, family) {
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'openai', missing: 'apiKey' }
        }
      )
    const data = await fetchJson(
      `${openaiBaseUrl(credentials)}/models`,
      (value) => idOnlyModelListSchema.parse(value),
      {
        timeout: TIMEOUTS.MODEL_FETCH,
        headers: buildHeaders(credentials, bearer(credentials.apiKey))
      }
    )
    const models =
      family === 'language' ? data.data.filter((model) => isResponsesModel(model.id)) : data.data
    if (family === 'image' || family === 'transcription' || family === 'speech') {
      return models
        .filter((model) => modelLooksLikeFamily(model.id, family))
        .map((model) => ({ id: model.id, name: formatModelName(model.id) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    const mapped = mapIdModels(
      models,
      family,
      family === 'embedding' ? 'OpenAI embedding model' : 'OpenAI model'
    )
    if (family !== 'embedding') return mapped
    return mapped.map((model) => {
      const dimensions = embeddingDimensions(model.id)
      return dimensions === undefined ? model : { ...model, dimensions }
    })
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
