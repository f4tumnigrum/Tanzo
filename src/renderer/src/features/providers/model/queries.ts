import { useQuery } from '@tanstack/react-query'
import type { ModelFamily, ProviderId } from '@/common/contracts'
import { providersClient } from '@/platform/electron/providers-client'
import { providerKeys } from './query-keys'

const PROVIDER_STALE_TIME = 30_000
const PROVIDER_GC_TIME = 30 * 60 * 1_000

export function useProviderCatalog() {
  return useQuery({
    queryKey: providerKeys.catalog(),
    queryFn: () => providersClient.listCatalog(),
    staleTime: PROVIDER_STALE_TIME,
    gcTime: PROVIDER_GC_TIME
  })
}

export function useProviderSetups() {
  return useQuery({
    queryKey: providerKeys.setups(),
    queryFn: () => providersClient.listSetups(),
    staleTime: PROVIDER_STALE_TIME,
    gcTime: PROVIDER_GC_TIME
  })
}

export function useProviderWorkspace(providerId: ProviderId) {
  return useQuery({
    queryKey: providerKeys.workspace(providerId),
    queryFn: () => providersClient.getWorkspace(providerId),
    staleTime: PROVIDER_STALE_TIME,
    gcTime: PROVIDER_GC_TIME
  })
}

export function useProviderKeys(providerId: ProviderId) {
  return useQuery({
    queryKey: providerKeys.keys(providerId),
    queryFn: () => providersClient.listKeys(providerId),
    staleTime: PROVIDER_STALE_TIME,
    gcTime: PROVIDER_GC_TIME
  })
}

export function useProviderOptionSchemas(
  providerId: ProviderId | null | undefined,
  family?: ModelFamily
) {
  return useQuery({
    queryKey: providerKeys.optionSchemas(providerId ?? undefined, family),
    queryFn: () => providersClient.listOptionSchemas(providerId ?? undefined, family),
    enabled: Boolean(providerId),
    staleTime: PROVIDER_STALE_TIME,
    gcTime: PROVIDER_GC_TIME
  })
}

export function useProviderReasoning(
  providerId: ProviderId | null | undefined,
  family?: ModelFamily
) {
  return useQuery({
    queryKey: providerKeys.reasoning(providerId ?? undefined, family),
    queryFn: () => providersClient.getReasoning(providerId as ProviderId, family),
    enabled: Boolean(providerId),
    staleTime: PROVIDER_STALE_TIME,
    gcTime: PROVIDER_GC_TIME
  })
}
