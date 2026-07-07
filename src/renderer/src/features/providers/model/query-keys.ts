import type { ModelFamily, ProviderId } from '@/common/contracts'

export const providerKeys = {
  all: ['providers'] as const,
  catalog: () => [...providerKeys.all, 'catalog'] as const,
  setups: () => [...providerKeys.all, 'setups'] as const,
  workspace: (providerId: ProviderId) => [...providerKeys.all, 'workspace', providerId] as const,
  keys: (providerId: ProviderId) => [...providerKeys.all, 'keys', providerId] as const,
  optionSchemas: (providerId?: ProviderId, family?: ModelFamily) =>
    [...providerKeys.all, 'option-schemas', providerId ?? 'all', family ?? 'all'] as const,
  reasoning: (providerId?: ProviderId, family?: ModelFamily) =>
    [...providerKeys.all, 'reasoning', providerId ?? 'all', family ?? 'all'] as const
}
