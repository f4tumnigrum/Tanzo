import { parseModelRef } from '@shared/provider'
import { createAnthropicStrategy } from './anthropic'
import { createDeepseekStrategy } from './deepseek'
import { createOpenAIStrategy, createOpenAICompatibleStrategy } from './openai'
import { createGoogleStrategy, createPassthroughStrategy } from './passthrough'
import type { ProviderContextStrategy } from './strategy'

export type { ProviderContextStrategy, CacheKind, CachingInput } from './strategy'

export function strategyFor(modelRef: string, chatId: string): ProviderContextStrategy {
  switch (parseModelRef(modelRef)?.providerId) {
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
