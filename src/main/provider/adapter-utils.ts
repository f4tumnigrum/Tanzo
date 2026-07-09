import type { ModelFamily } from '@shared/provider'
import type { ConnectionTestResult } from '@shared/provider'
import { formatModelName } from './http'
import type { Credentials, ProviderAdapter, RemoteModel } from './adapter-types'

export const TIMEOUTS = {
  CONNECTION_TEST: 10_000,
  MODEL_FETCH: 30_000
} as const

export function bearer(apiKey: string | undefined): Record<string, string> {
  const normalized = credentialText(apiKey)
  return normalized ? { Authorization: `Bearer ${normalized}` } : {}
}

export function credentialText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function mapIdModels(
  models: { id: string; owned_by?: string }[],
  family: ModelFamily,
  description: string
): RemoteModel[] {
  return models
    .filter((model) => modelLooksLikeFamily(model.id, family))
    .map((model) => ({
      id: model.id,
      name: formatModelName(model.id),
      description: model.owned_by ? `Owned by ${model.owned_by}` : description
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function modelLooksLikeFamily(id: string, family: ModelFamily): boolean {
  const normalized = id.toLowerCase()
  if (family === 'embedding')
    return normalized.includes('embedding') || normalized.includes('embed')
  if (family === 'image')
    return (
      normalized.includes('image') ||
      normalized.includes('dall-e') ||
      normalized.includes('imagen') ||
      normalized.includes('cogview') ||
      normalized.includes('glm-image')
    )
  if (family === 'transcription')
    return normalized.includes('transcribe') || normalized.includes('whisper')
  if (family === 'speech') return normalized.includes('tts') || normalized.includes('speech')
  return (
    !normalized.includes('embedding') &&
    !normalized.includes('embed') &&
    !normalized.includes('image') &&
    !normalized.includes('dall-e') &&
    !normalized.includes('imagen') &&
    !normalized.includes('cogview') &&
    !normalized.includes('glm-image') &&
    !normalized.includes('transcribe') &&
    !normalized.includes('whisper') &&
    !normalized.includes('tts') &&
    !normalized.includes('speech')
  )
}

export async function testByFetching(
  adapter: ProviderAdapter,
  credentials: Credentials
): Promise<ConnectionTestResult> {
  if (!adapter.validateCredentials(credentials)) {
    return { success: false, message: 'Missing required credentials.' }
  }
  const start = Date.now()
  try {
    const models = await adapter.fetchModels(credentials, 'language')
    return {
      success: true,
      message: `Connected successfully. ${models.length} models available.`,
      modelCount: models.length,
      latency: Date.now() - start
    }
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}
