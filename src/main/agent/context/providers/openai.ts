import type { CompiledContext } from '../section'
import type { CachingInput, ProviderContextStrategy } from './strategy'

/**
 * OpenAI prompt-cache routing (v2): per-conversation key. A shared global key
 * would route every conversation to the same cache shard and evict each
 * other's prefixes; per-chat keys keep each prefix family together.
 */
function chatPromptCacheKey(chatId: string): string {
  return `tanzo:chat:${chatId}`
}

function withPromptCacheKey(
  plan: CompiledContext,
  chatId: string,
  providerKey: 'openai' | 'openaiCompatible'
): CompiledContext {
  const prev = plan.providerOptions ?? {}
  const prevOptions = (prev[providerKey] as Record<string, unknown> | undefined) ?? {}
  const options = {
    ...prevOptions,
    promptCacheKey: chatPromptCacheKey(chatId),
    promptCacheRetention: '24h'
  }
  return {
    ...plan,
    providerOptions: {
      ...prev,
      [providerKey]: options
    }
  }
}

export function createOpenAIStrategy(chatId: string): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }: CachingInput) => withPromptCacheKey(plan, chatId, 'openai')
  }
}

export function createOpenAICompatibleStrategy(chatId: string): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }: CachingInput) => withPromptCacheKey(plan, chatId, 'openaiCompatible')
  }
}
