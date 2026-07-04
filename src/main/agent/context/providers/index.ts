import type { ProviderId } from '@shared/provider'
import { createAnthropicStrategy } from './anthropic'
import { createDeepseekStrategy } from './deepseek'
import { createOpenAIStrategy, createOpenAICompatibleStrategy } from './openai'
import { createGoogleStrategy, createPassthroughStrategy } from './passthrough'
import type { ProviderContextStrategy } from './strategy'

export type { ProviderContextStrategy, CacheKind, CachingInput } from './strategy'

function providerOf(modelRef: string): string {
  return modelRef.split(':', 1)[0]
}

export function strategyFor(modelRef: string, chatId: string): ProviderContextStrategy {
  const provider = providerOf(modelRef) as ProviderId
  switch (provider) {
    case 'anthropic':
      return createAnthropicStrategy()
    case 'openai':
    case 'openai-chat':
      return createOpenAIStrategy(chatId)
    case 'openai-compatible':
      return createOpenAICompatibleStrategy(chatId)
    case 'google':
      return createGoogleStrategy()
    case 'deepseek':
      return createDeepseekStrategy()
    default:
      return createPassthroughStrategy()
  }
}
