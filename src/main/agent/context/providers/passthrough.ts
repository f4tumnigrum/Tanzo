import type { ProviderContextStrategy } from './strategy'

/**
 * Google (Gemini) implicit caching benefits from the append-only prefix
 * invariant without explicit markers.
 */
export function createGoogleStrategy(): ProviderContextStrategy {
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
