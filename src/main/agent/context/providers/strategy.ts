import type { CompiledContext } from '../section'

export type CacheKind = 'ephemeral' | 'auto' | 'unsupported'

export interface CachingInput {
  plan: CompiledContext

  summaryIndex: number
}

export interface ProviderContextStrategy {
  cacheKind: CacheKind
  applyCaching(input: CachingInput): CompiledContext
}
