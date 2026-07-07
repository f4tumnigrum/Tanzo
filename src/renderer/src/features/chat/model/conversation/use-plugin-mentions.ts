import { useMemo } from 'react'
import type { PluginMentionOption } from '../../ui/compose/use-mention-menu'
import { usePluginsSnapshot } from '../../../plugins/model/queries'

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
