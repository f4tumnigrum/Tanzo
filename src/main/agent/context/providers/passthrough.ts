import type { ProviderContextStrategy } from './strategy'

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
