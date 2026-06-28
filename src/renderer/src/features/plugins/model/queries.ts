import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InstallPluginInput, SetPluginEnabledInput } from '@shared/plugins'
import { pluginsClient } from '@/platform/electron/plugins-client'
import { pluginKeys } from './query-keys'

const PLUGIN_STALE_TIME = 30_000
const PLUGIN_GC_TIME = 30 * 60 * 1_000

export function usePluginsSnapshot() {
  return useQuery({
    queryKey: pluginKeys.snapshot(),
    queryFn: () => pluginsClient.listPlugins(),
    staleTime: PLUGIN_STALE_TIME,
    gcTime: PLUGIN_GC_TIME
  })
}

export function usePluginDetail(id: string | null) {
  return useQuery({
    queryKey: pluginKeys.detail(id ?? ''),
    queryFn: () => pluginsClient.getPlugin(id as string),
    enabled: id !== null,
    staleTime: PLUGIN_STALE_TIME,
    gcTime: PLUGIN_GC_TIME
  })
}

export function useMarketplacePlugins() {
  return useQuery({
    queryKey: pluginKeys.marketplace(),
    queryFn: () => pluginsClient.listMarketplacePlugins(),
    staleTime: PLUGIN_STALE_TIME,
    gcTime: PLUGIN_GC_TIME
  })
}

export function usePluginMutations() {
  const queryClient = useQueryClient()
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: pluginKeys.all })
  }

  const setEnabled = useMutation({
    mutationFn: (input: SetPluginEnabledInput) => pluginsClient.setPluginEnabled(input),
    onSuccess: invalidate
  })
  const install = useMutation({
    mutationFn: (input: InstallPluginInput) => pluginsClient.installPlugin(input),
    onSuccess: invalidate
  })
  const uninstall = useMutation({
    mutationFn: (id: string) => pluginsClient.uninstallPlugin(id),
    onSuccess: invalidate
  })
  const reload = useMutation({
    mutationFn: () => pluginsClient.reloadPlugins(),
    onSuccess: invalidate
  })

  return { setEnabled, install, uninstall, reload }
}
