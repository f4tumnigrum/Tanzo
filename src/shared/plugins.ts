export const PLUGIN_CHANNELS = {
  list: 'plugins:list',
  get: 'plugins:get',
  setEnabled: 'plugins:set-enabled',
  install: 'plugins:install',
  uninstall: 'plugins:uninstall',
  listMarketplaces: 'plugins:list-marketplaces',
  reload: 'plugins:reload',
  listMarketplaceSources: 'plugins:list-marketplace-sources',
  addMarketplace: 'plugins:add-marketplace',
  removeMarketplace: 'plugins:remove-marketplace',
  upgradeMarketplace: 'plugins:upgrade-marketplace'
} as const

export type PluginInstallPolicy = 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT'

export type PluginAuthPolicy = 'ON_INSTALL' | 'ON_USE'

export interface PluginSummary {
  id: string
  pluginName: string
  marketplaceName: string

  version: string
  enabled: boolean
  displayName?: string
  description?: string

  contributes: {
    skills: boolean
    mcpServers: number
    hooks: boolean
  }

  error?: string
}

export interface PluginDetail extends PluginSummary {
  root: string
  category?: string
  keywords: string[]

  mcpServerNames: string[]
}

export interface PluginSnapshot {
  plugins: PluginSummary[]
  updatedAt: number
}

export interface MarketplacePluginEntry {
  id: string
  pluginName: string
  marketplaceName: string
  marketplaceDisplayName?: string
  displayName?: string
  description?: string
  category?: string
  installation: PluginInstallPolicy
  authentication: PluginAuthPolicy

  installed: boolean
}

export interface InstallPluginInput {
  id: string
  enableAfterInstall?: boolean
}

export interface SetPluginEnabledInput {
  id: string
  enabled: boolean
}

export type MarketplaceSourceType = 'git' | 'local'

export interface MarketplaceSourceSummary {
  name: string
  sourceType: MarketplaceSourceType

  source: string

  refName?: string

  sparsePaths: string[]

  lastRevision?: string
  installedAt: number
}

export interface AddMarketplaceInput {
  source: string

  refName?: string

  sparsePaths?: string[]
}

export interface AddMarketplaceResult {
  name: string
  sourceType: MarketplaceSourceType
  sourceDisplay: string
  alreadyAdded: boolean
}

export interface UpgradeMarketplaceResult {
  name: string

  updated: boolean
  revision: string | null
}

export interface PluginApi {
  listPlugins(): Promise<PluginSnapshot>
  getPlugin(id: string): Promise<PluginDetail | null>
  setPluginEnabled(input: SetPluginEnabledInput): Promise<PluginSnapshot>
  installPlugin(input: InstallPluginInput): Promise<PluginSnapshot>
  uninstallPlugin(id: string): Promise<PluginSnapshot>
  listMarketplacePlugins(): Promise<MarketplacePluginEntry[]>
  reloadPlugins(): Promise<PluginSnapshot>
  listMarketplaceSources(): Promise<MarketplaceSourceSummary[]>
  addMarketplace(input: AddMarketplaceInput): Promise<AddMarketplaceResult>
  removeMarketplace(name: string): Promise<MarketplaceSourceSummary[]>
  upgradeMarketplace(name: string): Promise<UpgradeMarketplaceResult>
}
