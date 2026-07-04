import type { ProviderContextStrategy } from './strategy'

/**
 * DeepSeek uses automatic prefix-hash caching. With the v2 append-only prefix
 * invariant (volatile content is persisted into the transcript instead of
 * re-rendered per step) no explicit markers or prefix freezing are needed.
 */
export function createDeepseekStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }) => plan
  }
}
