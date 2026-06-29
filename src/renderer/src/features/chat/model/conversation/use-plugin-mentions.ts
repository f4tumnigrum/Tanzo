import { useMemo } from 'react'
import type { PluginMentionOption } from '../../ui/compose/use-mention-menu'
import { usePluginsSnapshot } from '../../../plugins/model/queries'

/**
 * Enabled, error-free plugins offered as `@mention` suggestions in the composer.
 * The mention token is `displayName ?? pluginName`, which equals the main-side
 * skill namespace (`manifestName ?? pluginName`), so the parser always matches.
 */
export function usePluginMentions(): PluginMentionOption[] {
  const { data } = usePluginsSnapshot()
  return useMemo(() => {
    const plugins = data?.plugins ?? []
    return plugins
      .filter((plugin) => plugin.enabled && !plugin.error)
      .map((plugin) => ({
        name: plugin.displayName ?? plugin.pluginName,
        ...(plugin.description ? { description: plugin.description } : {})
      }))
  }, [data])
}
