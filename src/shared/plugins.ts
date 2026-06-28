export const PLUGIN_CHANNELS = {
  list: 'plugins:list',
  get: 'plugins:get',
  setEnabled: 'plugins:set-enabled',
  install: 'plugins:install',
  uninstall: 'plugins:uninstall',
  listMarketplaces: 'plugins:list-marketplaces',
  reload: 'plugins:reload'
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

export interface PluginApi {
  listPlugins(): Promise<PluginSnapshot>
  getPlugin(id: string): Promise<PluginDetail | null>
  setPluginEnabled(input: SetPluginEnabledInput): Promise<PluginSnapshot>
  installPlugin(input: InstallPluginInput): Promise<PluginSnapshot>
  uninstallPlugin(id: string): Promise<PluginSnapshot>
  listMarketplacePlugins(): Promise<MarketplacePluginEntry[]>
  reloadPlugins(): Promise<PluginSnapshot>
}
