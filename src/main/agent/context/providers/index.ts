import type { ProviderId } from '@shared/provider'
import { createAnthropicStrategy } from './anthropic'
import { createDeepseekStrategy } from './deepseek'
import { createOpenAIStrategy, createOpenAICompatibleStrategy } from './openai'
import { createGoogleStrategy } from './passthrough'
import type { ProviderContextStrategy } from './strategy'

export type { ProviderContextStrategy, CacheKind } from './strategy'

function providerOf(modelRef: string): string {
  return modelRef.split(':', 1)[0]
}

function createPassthroughStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'unsupported',
    applyCaching: (plan) => plan
  }
}

export function strategyFor(modelRef: string, _chatId: string): ProviderContextStrategy {
  void _chatId
  const provider = providerOf(modelRef) as ProviderId
  switch (provider) {
    case 'anthropic':
      return createAnthropicStrategy()
    case 'openai':
    case 'openai-chat':
      return createOpenAIStrategy(modelRef)
    case 'openai-compatible':
      return createOpenAICompatibleStrategy(modelRef)
    case 'google':
      return createGoogleStrategy()
    case 'deepseek':
      return createDeepseekStrategy()
    default:
      return createPassthroughStrategy()
  }
}
