import type { ProviderId } from '@shared/provider'
import { TanzoNotFoundError } from '@shared/errors'
import type { ProviderAdapter } from './adapter-types'
import { anthropicAdapter } from './adapters/anthropic'
import { deepseekAdapter } from './adapters/deepseek'
import { googleAdapter } from './adapters/google'
import { openaiAdapter } from './adapters/openai'
import { openaiChatAdapter } from './adapters/openai-chat'
import { openaiCompatibleAdapter } from './adapters/openai-compatible'

export type { Credentials, ProviderAdapter, RemoteModel } from './adapter-types'

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  'openai-chat': openaiChatAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  deepseek: deepseekAdapter,
  'openai-compatible': openaiCompatibleAdapter
}

export function getAdapter(providerId: ProviderId): ProviderAdapter {
  const adapter = ADAPTERS[providerId]
  if (!adapter) {
    throw new TanzoNotFoundError('PROVIDER_UNKNOWN', `Unknown provider: ${providerId}`, {
      details: { providerId }
    })
  }
  return adapter
}
