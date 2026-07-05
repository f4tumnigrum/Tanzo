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
    // The official SDK maps these camelCase options to prompt_cache_key /
    // prompt_cache_retention on the wire.
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
    // The openai-compatible SDK has no schema entry for prompt caching: keys
    // outside its options schema are copied into the request body verbatim.
    // Write the wire-format (snake_case) key directly so compatible backends
    // (vLLM, gateways) actually receive prompt_cache_key. No retention field —
    // it is OpenAI-proprietary and strict backends may reject unknown fields
    // they do not ignore.
    applyCaching: ({ plan }: CachingInput) =>
      withProviderOptions(plan, 'openaiCompatible', {
        prompt_cache_key: chatPromptCacheKey(chatId)
      })
  }
}
