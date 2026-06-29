import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MarketplacePluginEntry, PluginSummary } from '@shared/plugins'
import { errorMessage } from '@/common/lib/error-utils'
import {
  useMarketplacePlugins,
  usePluginDetail,
  usePluginMutations,
  usePluginsSnapshot
} from './queries'
import { usePluginDetailStore } from './store'

const EMPTY_PLUGINS: PluginSummary[] = []
const EMPTY_MARKET: MarketplacePluginEntry[] = []

export function usePluginsPageController() {
  const { t } = useTranslation()
  const snapshotQuery = usePluginsSnapshot()
  const marketplaceQuery = useMarketplacePlugins()
  const mutations = usePluginMutations()

  const [searchValue, setSearchValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PluginSummary | null>(null)
  const selectedPluginId = usePluginDetailStore((s) => s.selectedPluginId)
  const setSelectedPluginId = usePluginDetailStore((s) => s.setSelectedPluginId)
  const detailQuery = usePluginDetail(selectedPluginId)

  const plugins = snapshotQuery.data?.plugins ?? EMPTY_PLUGINS
  const marketplace = marketplaceQuery.data ?? EMPTY_MARKET

  const installedIds = useMemo(() => new Set(plugins.map((plugin) => plugin.id)), [plugins])

  // Marketplace entries not yet installed locally.
  const available = useMemo(
    () => marketplace.filter((entry) => !installedIds.has(entry.id)),
    [marketplace, installedIds]
  )

  const filteredPlugins = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    if (!query) return plugins
    return plugins.filter((plugin) =>
      [plugin.id, plugin.displayName, plugin.description]
        .filter((field): field is string => typeof field === 'string')
        .some((field) => field.toLowerCase().includes(query))
    )
  }, [plugins, searchValue])

  const filteredAvailable = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    if (!query) return available
    return available.filter((entry) =>
      [entry.id, entry.displayName, entry.description]
        .filter((field): field is string => typeof field === 'string')
        .some((field) => field.toLowerCase().includes(query))
    )
  }, [available, searchValue])

  const stats = useMemo(
    () => [
      { value: plugins.length, label: t('plugins.page.stats.installed') },
      {
        value: plugins.filter((plugin) => plugin.enabled).length,
        label: t('plugins.page.stats.enabled')
      },
      { value: available.length, label: t('plugins.page.stats.available') }
    ],
    [plugins, available, t]
  )

  async function togglePlugin(plugin: PluginSummary, enabled: boolean): Promise<void> {
    try {
      await mutations.setEnabled.mutateAsync({ id: plugin.id, enabled })
    } catch (error) {
      toast.error(errorMessage(error, t('plugins.toast.updateFailed')))
    }
  }

  async function installPlugin(entry: MarketplacePluginEntry): Promise<void> {
    try {
      await mutations.install.mutateAsync({ id: entry.id })
      toast.success(t('plugins.toast.installed'))
    } catch (error) {
      toast.error(errorMessage(error, t('plugins.toast.installFailed')))
    }
  }

  async function confirmUninstall(): Promise<void> {
    if (!deleteTarget) return
    try {
      await mutations.uninstall.mutateAsync(deleteTarget.id)
      // Clear a detail-view selection pointing at the now-removed plugin so a
      // later reinstall of the same id does not silently reopen the detail page.
      if (selectedPluginId === deleteTarget.id) setSelectedPluginId(null)
      setDeleteTarget(null)
      toast.success(t('plugins.toast.uninstalled'))
    } catch (error) {
      toast.error(errorMessage(error, t('plugins.toast.uninstallFailed')))
    }
  }

  async function reload(): Promise<void> {
    try {
      await mutations.reload.mutateAsync()
    } catch (error) {
      toast.error(errorMessage(error, t('plugins.toast.reloadFailed')))
    }
  }

  // A selected plugin still present in the snapshot routes to the detail view.
  const selectedPlugin = useMemo(
    () =>
      selectedPluginId ? (plugins.find((plugin) => plugin.id === selectedPluginId) ?? null) : null,
    [plugins, selectedPluginId]
  )

  return {
    loading: snapshotQuery.isLoading,
    reloading: mutations.reload.isPending,
    selectedPlugin,
    detail: detailQuery.data ?? null,
    detailLoading: detailQuery.isPending,
    setSelectedPluginId,
    installingId: mutations.install.isPending ? mutations.install.variables?.id : undefined,
    plugins,
    filteredPlugins,
    filteredAvailable,
    stats,
    searchValue,
    setSearchValue,
    deleteTarget,
    setDeleteTarget,
    togglePlugin,
    installPlugin,
    confirmUninstall,
    reload
  }
}
