import type { CompiledContext } from '../section'

export type CacheKind = 'ephemeral' | 'auto' | 'unsupported'

export interface CachingInput {
  plan: CompiledContext
  /** Index into `plan.history` of the latest compaction summary, or -1. */
  summaryIndex: number
}

export interface ProviderContextStrategy {
  cacheKind: CacheKind
  applyCaching(input: CachingInput): CompiledContext
}
