import { parseModelRef } from '@shared/provider'
import { createAnthropicStrategy } from './anthropic'
import { createDeepseekStrategy } from './deepseek'
import { createOpenAIStrategy, createOpenAICompatibleStrategy } from './openai'
import { createGoogleStrategy, createGrokStrategy, createPassthroughStrategy } from './passthrough'
import type { ProviderContextStrategy } from './strategy'

export type { ProviderContextStrategy, CacheKind, CachingInput } from './strategy'

export function strategyFor(modelRef: string, chatId: string): ProviderContextStrategy {
  const parsed = parseModelRef(modelRef)
  switch (parsed?.providerId) {
    case 'anthropic':
      return createAnthropicStrategy()
    case 'openai':
    case 'openai-chat':
      return createOpenAIStrategy(chatId, parsed.modelId)
    case 'openai-compatible':
      return createOpenAICompatibleStrategy(chatId)
    case 'grok':
      return createGrokStrategy()
    case 'google':
      return createGoogleStrategy()
    case 'deepseek':
      return createDeepseekStrategy()
    default:
      return createPassthroughStrategy()
  }
}
