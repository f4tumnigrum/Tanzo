import type { ProviderContextStrategy } from './strategy'

export function createGoogleStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }) => plan
  }
}

// xAI Grok performs automatic prefix-based prompt caching server-side; there is
// no in-body cache directive to set. Cache-hit rate is steered by the
// `x-grok-conv-id` request header (see conversationRequestHeaders), not the plan.
export function createGrokStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }) => plan
  }
}

export function createPassthroughStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'unsupported',
    applyCaching: ({ plan }) => plan
  }
}
