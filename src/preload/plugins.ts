import { PLUGIN_CHANNELS, type PluginApi } from '@shared/plugins'
import { invoke } from './invoke'

export const pluginsApi: PluginApi = {
  listPlugins: invoke<PluginApi['listPlugins']>(PLUGIN_CHANNELS.list),
  getPlugin: invoke<PluginApi['getPlugin']>(PLUGIN_CHANNELS.get),
  setPluginEnabled: invoke<PluginApi['setPluginEnabled']>(PLUGIN_CHANNELS.setEnabled),
  installPlugin: invoke<PluginApi['installPlugin']>(PLUGIN_CHANNELS.install),
  uninstallPlugin: invoke<PluginApi['uninstallPlugin']>(PLUGIN_CHANNELS.uninstall),
  listMarketplacePlugins: invoke<PluginApi['listMarketplacePlugins']>(
    PLUGIN_CHANNELS.listMarketplaces
  ),
  reloadPlugins: invoke<PluginApi['reloadPlugins']>(PLUGIN_CHANNELS.reload),
  listMarketplaceSources: invoke<PluginApi['listMarketplaceSources']>(
    PLUGIN_CHANNELS.listMarketplaceSources
  ),
  addMarketplace: invoke<PluginApi['addMarketplace']>(PLUGIN_CHANNELS.addMarketplace),
  removeMarketplace: invoke<PluginApi['removeMarketplace']>(PLUGIN_CHANNELS.removeMarketplace),
  upgradeMarketplace: invoke<PluginApi['upgradeMarketplace']>(PLUGIN_CHANNELS.upgradeMarketplace)
}

export type PluginsPreloadApi = typeof pluginsApi
