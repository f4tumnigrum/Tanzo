import type { ProviderContextStrategy } from './strategy'

export function createDeepseekStrategy(): ProviderContextStrategy {
  return {
    cacheKind: 'auto',
    applyCaching: ({ plan }) => plan
  }
}
