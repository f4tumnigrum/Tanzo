import { z } from 'zod'
import { PLUGIN_CHANNELS } from '@shared/plugins'
import type { AgentIpcDeps, IpcRegistration } from './types'

const pluginIdSchema = z.string().trim().min(1)

const setEnabledSchema = z.object({
  id: pluginIdSchema,
  enabled: z.boolean()
})

const installSchema = z.object({
  id: pluginIdSchema,
  enableAfterInstall: z.boolean().optional()
})

export function pluginHandlers(deps: AgentIpcDeps): IpcRegistration[] {
  return [
    [PLUGIN_CHANNELS.list, () => deps.plugins.list()],
    [PLUGIN_CHANNELS.get, (id) => deps.plugins.detail(pluginIdSchema.parse(id))],
    [
      PLUGIN_CHANNELS.setEnabled,
      (input) => {
        const parsed = setEnabledSchema.parse(input)
        return deps.plugins.setEnabled(parsed.id, parsed.enabled)
      }
    ],
    [PLUGIN_CHANNELS.install, (input) => deps.plugins.install(installSchema.parse(input))],
    [PLUGIN_CHANNELS.uninstall, (id) => deps.plugins.uninstall(pluginIdSchema.parse(id))],
    [PLUGIN_CHANNELS.listMarketplaces, () => deps.plugins.listMarketplacePlugins()],
    [PLUGIN_CHANNELS.reload, () => deps.plugins.reload()]
  ]
}
