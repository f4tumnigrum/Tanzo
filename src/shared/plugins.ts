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

/** Marketplace install-availability policy (Codex-compatible enum). */
export type PluginInstallPolicy = 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT'
/** When a plugin authenticates (Codex-compatible enum). */
export type PluginAuthPolicy = 'ON_INSTALL' | 'ON_USE'

/** A plugin currently installed in the local cache. */
export interface PluginSummary {
  /** `<plugin>@<marketplace>` identity key. */
  id: string
  pluginName: string
  marketplaceName: string
  /** Active installed version (`local` for unversioned sources). */
  version: string
  enabled: boolean
  displayName?: string
  description?: string
  /** Count of each contribution kind the active plugin provides. */
  contributes: {
    skills: boolean
    mcpServers: number
    hooks: boolean
  }
  /** Present when the plugin failed to load from its cache root. */
  error?: string
}

export interface PluginDetail extends PluginSummary {
  root: string
  category?: string
  keywords: string[]
  /** MCP server names contributed by this plugin. */
  mcpServerNames: string[]
}

export interface PluginSnapshot {
  plugins: PluginSummary[]
  updatedAt: number
}

/** A plugin entry available in a discovered marketplace. */
export interface MarketplacePluginEntry {
  /** `<plugin>@<marketplace>` identity key. */
  id: string
  pluginName: string
  marketplaceName: string
  marketplaceDisplayName?: string
  displayName?: string
  description?: string
  category?: string
  installation: PluginInstallPolicy
  authentication: PluginAuthPolicy
  /** True when this plugin is already installed in the local cache. */
  installed: boolean
}

export interface InstallPluginInput {
  /** `<plugin>@<marketplace>` identity key to install from a discovered marketplace. */
  id: string
  enableAfterInstall?: boolean
}

export interface SetPluginEnabledInput {
  id: string
  enabled: boolean
}

/** How a registered marketplace was sourced. */
export type MarketplaceSourceType = 'git' | 'local'

/** A registered marketplace source (git clone or local directory). */
export interface MarketplaceSourceSummary {
  /** Marketplace name, read from its `marketplace.json`. */
  name: string
  sourceType: MarketplaceSourceType
  /** Git URL for `git` sources, or the absolute directory for `local` sources. */
  source: string
  /** Branch / tag / SHA; git sources only. */
  refName?: string
  /** Sparse-checkout paths; git sources only. */
  sparsePaths: string[]
  /** Last cloned commit SHA; git sources only. */
  lastRevision?: string
  installedAt: number
}

export interface AddMarketplaceInput {
  /** Raw source string: `owner/repo`, a git URL/SSH, or a local path. */
  source: string
  /** Explicit ref (branch/tag/SHA); git sources only. */
  refName?: string
  /** Sparse-checkout paths; git sources only. */
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
  /** True when a new revision was cloned and activated. */
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
