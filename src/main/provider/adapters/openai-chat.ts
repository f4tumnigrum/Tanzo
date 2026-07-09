import { createOpenAI } from '@ai-sdk/openai'
import { TanzoValidationError } from '@shared/errors'
import { buildHeaders, ensureUrlProtocol, fetchJson, idOnlyModelListSchema } from '../http'
import type { Credentials, ProviderAdapter } from '../adapter-types'
import { bearer, credentialText, mapIdModels, testByFetching, TIMEOUTS } from '../adapter-utils'

function openaiChatBaseUrl(credentials: Credentials): string {
  const normalized = ensureUrlProtocol(credentials.baseUrl, 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  )
  if (normalized === 'https://api.openai.com') return 'https://api.openai.com/v1'
  if (normalized.endsWith('/openai')) return `${normalized}/v1`
  return normalized
}

function openaiChatProvider(credentials: Credentials) {
  const organization = credentialText(credentials.organization)
  const project = credentialText(credentials.project)
  return createOpenAI({
    apiKey: credentialText(credentials.apiKey),
    baseURL: openaiChatBaseUrl(credentials),
    ...(organization ? { organization } : {}),
    ...(project ? { project } : {})
  })
}

function isChatModel(id: string): boolean {
  const normalized = id.toLowerCase()
  return (
    !normalized.includes('moderation') &&
    !normalized.includes('instruct') &&
    !normalized.includes('babbage') &&
    !normalized.includes('davinci')
  )
}

export const openaiChatAdapter: ProviderAdapter = {
  providerId: 'openai-chat',
  validateCredentials: (credentials) => Boolean(credentials.apiKey?.trim()),
  createLanguageModel(modelId, credentials) {
    return openaiChatProvider(credentials).chat(modelId)
  },
  async fetchModels(credentials, family) {
    if (family !== 'language') return []
    if (!this.validateCredentials(credentials))
      throw new TanzoValidationError(
        'PROVIDER_CREDENTIALS_MISSING',
        'Missing required credentials: apiKey',
        {
          details: { providerId: 'openai-chat', missing: 'apiKey' }
        }
      )
    const data = await fetchJson(
      `${openaiChatBaseUrl(credentials)}/models`,
      (value) => idOnlyModelListSchema.parse(value),
      {
        timeout: TIMEOUTS.MODEL_FETCH,
        headers: buildHeaders(credentials, bearer(credentials.apiKey))
      }
    )
    return mapIdModels(
      data.data.filter((model) => isChatModel(model.id)),
      family,
      'OpenAI model (Chat Completions)'
    )
  },
  testConnection(credentials) {
    return testByFetching(this, credentials)
  }
}
