import type {
  AddMarketplaceInput,
  AddMarketplaceResult,
  InstallPluginInput,
  MarketplacePluginEntry,
  MarketplaceSourceSummary,
  PluginApi,
  PluginDetail,
  PluginSnapshot,
  SetPluginEnabledInput,
  UpgradeMarketplaceResult
} from '@shared/plugins'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

function requirePluginsApi(): PluginApi {
  const pluginsApi = window.electron?.plugins
  if (!pluginsApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_PLUGINS_API_UNAVAILABLE',
      'Electron plugins API is not available'
    )
  }
  return withDecodedIpcErrors(pluginsApi)
}

export const pluginsClient = {
  listPlugins(): Promise<PluginSnapshot> {
    return requirePluginsApi().listPlugins()
  },
  getPlugin(id: string): Promise<PluginDetail | null> {
    return requirePluginsApi().getPlugin(id)
  },
  setPluginEnabled(input: SetPluginEnabledInput): Promise<PluginSnapshot> {
    return requirePluginsApi().setPluginEnabled(input)
  },
  installPlugin(input: InstallPluginInput): Promise<PluginSnapshot> {
    return requirePluginsApi().installPlugin(input)
  },
  uninstallPlugin(id: string): Promise<PluginSnapshot> {
    return requirePluginsApi().uninstallPlugin(id)
  },
  listMarketplacePlugins(): Promise<MarketplacePluginEntry[]> {
    return requirePluginsApi().listMarketplacePlugins()
  },
  reloadPlugins(): Promise<PluginSnapshot> {
    return requirePluginsApi().reloadPlugins()
  },
  listMarketplaceSources(): Promise<MarketplaceSourceSummary[]> {
    return requirePluginsApi().listMarketplaceSources()
  },
  addMarketplace(input: AddMarketplaceInput): Promise<AddMarketplaceResult> {
    return requirePluginsApi().addMarketplace(input)
  },
  removeMarketplace(name: string): Promise<MarketplaceSourceSummary[]> {
    return requirePluginsApi().removeMarketplace(name)
  },
  upgradeMarketplace(name: string): Promise<UpgradeMarketplaceResult> {
    return requirePluginsApi().upgradeMarketplace(name)
  }
}
