import { CollapsibleGrid } from '@/components/ui/collapsible-grid'
import type { MarketplacePluginEntry, PluginSummary } from '@shared/plugins'
import { AvailablePluginCard, InstalledPluginCard } from './plugin-card'

export function InstalledPluginsGrid({
  title,
  plugins,
  defaultOpen,
  pageSize,
  onOpen,
  onToggle,
  onUninstall
}: {
  title: string
  plugins: PluginSummary[]
  defaultOpen?: boolean
  pageSize?: number
  onOpen: (plugin: PluginSummary) => void
  onToggle: (plugin: PluginSummary, enabled: boolean) => void
  onUninstall: (plugin: PluginSummary) => void
}): React.ReactElement | null {
  return (
    <CollapsibleGrid
      title={title}
      items={plugins}
      getItemKey={(plugin) => plugin.id}
      defaultOpen={defaultOpen}
      pageSize={pageSize}
      renderItem={(plugin) => (
        <InstalledPluginCard
          plugin={plugin}
          onOpen={() => onOpen(plugin)}
          onToggle={(enabled) => onToggle(plugin, enabled)}
          onUninstall={() => onUninstall(plugin)}
        />
      )}
    />
  )
}

export function AvailablePluginsGrid({
  title,
  entries,
  installingId,
  pageSize,
  defaultOpen,
  onInstall
}: {
  title: string
  entries: MarketplacePluginEntry[]
  installingId: string | undefined
  pageSize?: number
  defaultOpen?: boolean
  onInstall: (entry: MarketplacePluginEntry) => void
}): React.ReactElement | null {
  return (
    <CollapsibleGrid
      title={title}
      items={entries}
      getItemKey={(entry) => entry.id}
      pageSize={pageSize}
      defaultOpen={defaultOpen}
      renderItem={(entry) => (
        <AvailablePluginCard
          entry={entry}
          installing={installingId === entry.id}
          onInstall={() => onInstall(entry)}
        />
      )}
    />
  )
}
