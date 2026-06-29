import { CollapsibleGrid } from '@/components/ui/collapsible-grid'
import type { MarketplacePluginEntry, PluginSummary } from '@shared/plugins'
import { AvailablePluginCard, InstalledPluginCard } from './plugin-card'

export function InstalledPluginsGrid({
  title,
  plugins,
  defaultOpen,
  onOpen,
  onToggle,
  onUninstall
}: {
  title: string
  plugins: PluginSummary[]
  defaultOpen?: boolean
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
  onInstall
}: {
  title: string
  entries: MarketplacePluginEntry[]
  installingId: string | undefined
  onInstall: (entry: MarketplacePluginEntry) => void
}): React.ReactElement | null {
  return (
    <CollapsibleGrid
      title={title}
      items={entries}
      getItemKey={(entry) => entry.id}
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
