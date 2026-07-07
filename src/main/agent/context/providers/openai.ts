import type { CompiledContext } from '../section'
import type { CachingInput, ProviderContextStrategy } from './strategy'

function chatPromptCacheKey(chatId: string): string {
  return `tanzo:chat:${chatId}`
}

function withProviderOptions(
  plan: CompiledContext,
  providerKey: string,
  options: Record<string, string>
): CompiledContext {
  const prev = plan.providerOptions ?? {}
  const prevOptions = (prev[providerKey] as Record<string, string> | undefined) ?? {}
  return {
    ...plan,
    providerOptions: {
      ...prev,
      [providerKey]: { ...prevOptions, ...options }
    }
  }
}

export function createOpenAIStrategy(chatId: string): ProviderContextStrategy {
  return {
    cacheKind: 'auto',

    applyCaching: ({ plan }: CachingInput) =>
      withProviderOptions(plan, 'openai', {
        promptCacheKey: chatPromptCacheKey(chatId),
        promptCacheRetention: '24h'
      })
  }
}

export function createOpenAICompatibleStrategy(chatId: string): ProviderContextStrategy {
  return {
    cacheKind: 'auto',

    applyCaching: ({ plan }: CachingInput) =>
      withProviderOptions(plan, 'openaiCompatible', {
        prompt_cache_key: chatPromptCacheKey(chatId)
      })
  }
}
