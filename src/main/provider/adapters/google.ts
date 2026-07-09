import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { TanzoValidationError } from '@shared/errors'
import { ensureUrlProtocol, fetchJson, formatModelName, googleModelListSchema } from '../http'
import type { Credentials, ProviderAdapter, RemoteModel } from '../adapter-types'
import { credentialText, testByFetching, TIMEOUTS } from '../adapter-utils'

function googleBaseUrl(credentials: Credentials): string {
  const normalized = ensureUrlProtocol(
    credentials.baseUrl,
    'https://generativelanguage.googleapis.com/v1beta'
  ).replace(/\/+$/, '')
  if (normalized.endsWith('/v1') || normalized.endsWith('/v1beta')) return normalized
  return `${normalized}/v1beta`
}

function googleProvider(credentials: Credentials) {
  return createGoogleGenerativeAI({
    apiKey: credentialText(credentials.apiKey),
    baseURL: googleBaseUrl(credentials)
  })
}

async function fetchGoogleModels(
  credentials: Credentials,
  family: 'language' | 'embedding'
): Promise<RemoteModel[]> {
  const seen = new Set<string>()
  const out: RemoteModel[] = []
  let pageToken: string | undefined

  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${googleBaseUrl(credentials)}/models`)
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const data = await fetchJson(url.toString(), (value) => googleModelListSchema.parse(value), {
      timeout: TIMEOUTS.MODEL_FETCH,
      headers: { 'x-goog-api-key': credentialText(credentials.apiKey) ?? '' }
    })

    for (const model of data.models ?? []) {
      const id = (model.baseModelId || model.name || '').replace(/^models\//, '').trim()
      if (!id || seen.has(id)) continue
      const methods = (model.supportedGenerationMethods ?? []).map((method) => method.toLowerCase())
      const supportsEmbedding = methods.some((method) => method.includes('embed'))
      const supportsLanguage = methods.some((method) => method.includes('generatecontent'))
      if (family === 'embedding' && !supportsEmbedding) continue
      if (family === 'language' && !supportsLanguage) continue
      seen.add(id)
      out.push({
        id,
        name: model.displayName?.trim() || formatModelName(id),
        description:
          model.description?.trim() ||
          (family === 'embedding' ? 'Google embedding model' : 'Google model')
      })
    }

    const nextPageToken = data.nextPageToken?.trim()
    if (!nextPageToken || nextPageToken === pageToken) break
    pageToken = nextPageToken
  }

  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const googleAdapter: ProviderAdapter = {
  providerId: 'google',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return googleProvider(credentials)(modelId)
  },
  createEmbeddingModel(modelId, credentials) {
    return googleProvider(credentials).embedding(modelId)
  },
  createImageModel(modelId, credentials) {
    return googleProvider(credentials).image(modelId)
  },
  async fetchModels(credentials, family) {
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'google', missing: 'apiKey' }
        }
      )
    if (family === 'image' || family === 'transcription' || family === 'speech') return []
    return fetchGoogleModels(credentials, family)
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
