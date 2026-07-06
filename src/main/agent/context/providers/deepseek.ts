import type { ProviderContextStrategy } from './strategy'

/**
 * DeepSeek on-disk caching is fully automatic with no request-side control
 * surface (no markers, no cache key) — hence a no-op strategy. It matches whole
 * "cache prefix units" (carved at user-input / model-output ends and fixed
 * token intervals under Sliding Window Attention), so a hit requires a request
 * to *fully match* a persisted unit; the v2 append-only prefix invariant (I1) —
 * volatile content persisted into the transcript instead of re-rendered per
 * step — is what keeps the prefix byte-stable enough to match. It is
 * best-effort (no 100% hit guarantee), skips inputs < 64 tokens, and evicts
 * units after hours-to-days, so cache-read is choppier than Anthropic's.
 */
export function createDeepseekStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }) => plan
  }
}
