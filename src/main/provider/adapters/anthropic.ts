import { createAnthropic } from '@ai-sdk/anthropic'
import { TanzoValidationError } from '@shared/errors'
import { anthropicModelListSchema, ensureUrlProtocol, fetchJson, formatModelName } from '../http'
import type { Credentials, ProviderAdapter, RemoteModel } from '../adapter-types'
import { credentialText, testByFetching, TIMEOUTS } from '../adapter-utils'

function anthropicBaseUrl(credentials: Credentials): string {
  const normalized = ensureUrlProtocol(credentials.baseUrl, 'https://api.anthropic.com/v1').replace(
    /\/+$/,
    ''
  )
  return normalized === 'https://api.anthropic.com' ? `${normalized}/v1` : normalized
}

function anthropicHeaders(credentials: Credentials): Record<string, string> {
  return {
    'x-api-key': credentialText(credentials.apiKey) ?? '',
    'anthropic-version': '2023-06-01'
  }
}

async function fetchAnthropicModels(credentials: Credentials): Promise<RemoteModel[]> {
  const out: RemoteModel[] = []
  const seen = new Set<string>()
  let afterId: string | undefined
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${anthropicBaseUrl(credentials)}/models`)
    url.searchParams.set('limit', '1000')
    if (afterId) url.searchParams.set('after_id', afterId)
    const data = await fetchJson(url.toString(), (value) => anthropicModelListSchema.parse(value), {
      timeout: TIMEOUTS.MODEL_FETCH,
      headers: anthropicHeaders(credentials)
    })
    for (const model of data.data) {
      const id = model.id.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        name: model.display_name?.trim() || formatModelName(id),
        description: 'Anthropic model'
      })
    }
    const nextAfterId = data.last_id?.trim()
    if (!data.has_more || !nextAfterId || nextAfterId === afterId) break
    afterId = nextAfterId
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const anthropicAdapter: ProviderAdapter = {
  providerId: 'anthropic',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return createAnthropic({
      apiKey: credentialText(credentials.apiKey),
      baseURL: anthropicBaseUrl(credentials)
    })(modelId)
  },
  async fetchModels(credentials, family) {
    if (family !== 'language') return []
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'anthropic', missing: 'apiKey' }
        }
      )
    return fetchAnthropicModels(credentials)
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
