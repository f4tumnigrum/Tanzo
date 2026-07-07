import { homedir } from 'node:os'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type {
  AddMarketplaceInput,
  AddMarketplaceResult,
  InstallPluginInput,
  MarketplacePluginEntry,
  MarketplaceSourceSummary,
  PluginDetail,
  PluginSnapshot,
  PluginSummary,
  UpgradeMarketplaceResult
} from '@shared/plugins'
import type { McpServerConfig } from '@shared/mcp'
import type { Logger } from '../logging'
import { loadPluginManifest } from './manifest'
import { parsePluginId, pluginIdKey, type PluginId } from './plugin-id'
import { toMcpServerConfig, type PluginHookSourceInput } from './adapters'
import {
  findMarketplacePath,
  loadMarketplace,
  type Marketplace,
  type MarketplacePlugin
} from './marketplace'
import {
  loadPlugins,
  type ConfiguredPlugin,
  type LoadedPlugin,
  type PluginLoadOutcome
} from './loader'
import type { PluginStore } from './store'
import type { PluginStateStore } from './plugin-state-db'
import type { MarketplaceInstaller } from './marketplace-install'
import type { MarketplaceSourceRecord } from './marketplace-source-db'

export interface PluginCapabilitySummary {
  name: string
  description?: string

  hasSkills: boolean

  mcpServerNames: string[]
}

export interface PluginsManagerDeps {
  store: PluginStore
  state: PluginStateStore | null

  marketplaceRoots: string[]

  installer: MarketplaceInstaller | null
  logger: Logger
}

export interface PluginsManager {
  list(): PluginSnapshot
  detail(id: string): PluginDetail | null
  setEnabled(id: string, enabled: boolean): PluginSnapshot
  install(input: InstallPluginInput): PluginSnapshot
  uninstall(id: string): PluginSnapshot

  listMarketplacePlugins(): MarketplacePluginEntry[]

  loadOutcome(): PluginLoadOutcome

  skillRoots(): { dir: string; namespace: string }[]

  mcpServers(): McpServerConfig[]

  hookSources(): PluginHookSourceInput[]

  capabilitySummaries(): PluginCapabilitySummary[]

  onContributionsChanged(listener: () => void): () => void
  reload(): PluginSnapshot

  listMarketplaceSources(): MarketplaceSourceSummary[]

  addMarketplace(input: AddMarketplaceInput): Promise<AddMarketplaceResult>

  removeMarketplace(name: string): MarketplaceSourceSummary[]

  upgradeMarketplace(name: string): Promise<UpgradeMarketplaceResult>
}

export function defaultMarketplaceRoots(workspaceRoot: string): string[] {
  return [homedir(), workspaceRoot]
}

export function createPluginsManager(deps: PluginsManagerDeps): PluginsManager {
  const { store, state, logger } = deps

  function discoverMarketplaces(): Marketplace[] {
    const found: Marketplace[] = []
    const seenManifests = new Set<string>()

    const roots = [...deps.marketplaceRoots, ...(deps.installer?.resolveRoots() ?? [])]
    for (const root of roots) {
      const path = findMarketplacePath(root)
      if (!path || seenManifests.has(path)) continue
      seenManifests.add(path)
      const market = loadMarketplace(path, logger)
      if (market) found.push(market)
    }
    return found
  }

  function findMarketplacePlugin(id: PluginId): MarketplacePlugin | undefined {
    for (const market of discoverMarketplaces()) {
      if (market.name !== id.marketplaceName) continue
      const entry = market.plugins.find((plugin) => plugin.name === id.pluginName)
      if (entry) return entry
    }
    return undefined
  }

  function configuredPlugins(): ConfiguredPlugin[] {
    const records = state?.all() ?? new Map()
    const configured: ConfiguredPlugin[] = []
    for (const record of records.values()) {
      if (!record.installed) continue
      const parsed = parsePluginId(record.configKey)
      if (!parsed.ok) {
        logger.warn(`ignoring plugin state with invalid key "${record.configKey}": ${parsed.error}`)
        continue
      }
      configured.push({ id: parsed.id, enabled: record.enabled })
    }
    return configured
  }

  function loadOutcome(): PluginLoadOutcome {
    return loadPlugins(configuredPlugins(), store, logger)
  }

  const changeListeners = new Set<() => void>()
  function emitChanged(): void {
    for (const listener of changeListeners) {
      try {
        listener()
      } catch (error) {
        logger.warn('plugin contribution listener failed', error)
      }
    }
  }

  function toSummary(plugin: LoadedPlugin): PluginSummary {
    const record = state?.get(plugin.configKey)
    return {
      id: plugin.configKey,
      pluginName: plugin.id.pluginName,
      marketplaceName: plugin.id.marketplaceName,
      version: store.activePluginVersion(plugin.id) ?? record?.version ?? 'local',
      enabled: plugin.enabled,
      ...(plugin.manifestName ? { displayName: plugin.manifestName } : {}),
      ...(plugin.manifestDescription ? { description: plugin.manifestDescription } : {}),
      contributes: {
        skills: plugin.skillRoot !== null,
        mcpServers: plugin.mcpServers.length,
        hooks: plugin.hooksPath !== null
      },
      ...(plugin.error ? { error: plugin.error } : {})
    }
  }

  function snapshot(): PluginSnapshot {
    const plugins = loadOutcome().plugins.map(toSummary)
    return { plugins, updatedAt: Date.now() }
  }

  function requireInstaller(): MarketplaceInstaller {
    if (!deps.installer) {
      throw new TanzoValidationError(
        'MARKETPLACE_PERSISTENCE_UNAVAILABLE',
        'Marketplace registration is unavailable without a database.'
      )
    }
    return deps.installer
  }

  function toSourceSummary(record: MarketplaceSourceRecord): MarketplaceSourceSummary {
    return {
      name: record.name,
      sourceType: record.sourceType,
      source: record.source,
      ...(record.refName ? { refName: record.refName } : {}),
      sparsePaths: record.sparsePaths,
      ...(record.lastRevision ? { lastRevision: record.lastRevision } : {}),
      installedAt: record.installedAt
    }
  }

  return {
    list: snapshot,

    detail(id) {
      const parsed = parsePluginId(id)
      if (!parsed.ok) return null
      const root = store.activePluginRoot(parsed.id)
      if (!root) return null
      const outcome = loadPlugins([{ id: parsed.id, enabled: true }], store, logger)
      const plugin = outcome.plugins[0]
      if (!plugin) return null
      const manifest = loadPluginManifest(root, logger)
      const entry = findMarketplacePlugin(parsed.id)
      return {
        ...toSummary({ ...plugin, enabled: state?.get(id)?.enabled !== false }),
        root,
        ...(entry?.category ? { category: entry.category } : {}),
        keywords: manifest?.keywords ?? [],
        mcpServerNames: plugin.mcpServers.map((server) => server.name)
      }
    },

    setEnabled(id, enabled) {
      const parsed = parsePluginId(id)
      if (!parsed.ok) {
        throw new TanzoValidationError('PLUGIN_ID_INVALID', parsed.error)
      }
      if (!store.isInstalled(parsed.id)) {
        throw new TanzoNotFoundError('PLUGIN_NOT_FOUND', `Plugin "${id}" is not installed.`)
      }
      state?.setEnabled(id, enabled)
      emitChanged()
      return snapshot()
    },

    install(input) {
      const parsed = parsePluginId(input.id)
      if (!parsed.ok) {
        throw new TanzoValidationError('PLUGIN_ID_INVALID', parsed.error)
      }
      const entry = findMarketplacePlugin(parsed.id)
      if (!entry) {
        throw new TanzoNotFoundError(
          'PLUGIN_NOT_IN_MARKETPLACE',
          `Plugin "${input.id}" was not found in any discovered marketplace.`
        )
      }
      const result = store.install(entry.source.path, parsed.id)
      state?.recordInstall({
        configKey: input.id,
        pluginName: parsed.id.pluginName,
        marketplaceName: parsed.id.marketplaceName,
        enabled: input.enableAfterInstall !== false,
        version: result.version,
        sourcePath: entry.source.path,
        installedAt: Date.now()
      })
      emitChanged()
      return snapshot()
    },

    uninstall(id) {
      const parsed = parsePluginId(id)
      if (!parsed.ok) {
        throw new TanzoValidationError('PLUGIN_ID_INVALID', parsed.error)
      }
      store.uninstall(parsed.id)
      state?.remove(id)
      emitChanged()
      return snapshot()
    },

    listMarketplacePlugins() {
      const entries: MarketplacePluginEntry[] = []
      for (const market of discoverMarketplaces()) {
        for (const plugin of market.plugins) {
          const idResult = parsePluginId(`${plugin.name}@${market.name}`)
          if (!idResult.ok) continue
          const id = pluginIdKey(idResult.id)

          const manifest = loadPluginManifest(plugin.source.path, logger)
          const displayName = manifest?.interface?.displayName ?? manifest?.name
          entries.push({
            id,
            pluginName: plugin.name,
            marketplaceName: market.name,
            ...(market.displayName ? { marketplaceDisplayName: market.displayName } : {}),
            ...(displayName ? { displayName } : {}),
            ...(manifest?.description ? { description: manifest.description } : {}),
            ...(plugin.category ? { category: plugin.category } : {}),
            installation: plugin.installation,
            authentication: plugin.authentication,
            installed: store.isInstalled(idResult.id)
          })
        }
      }
      return entries
    },

    loadOutcome,

    skillRoots() {
      return loadOutcome()
        .effectiveSkillRoots()
        .map((root) => ({ dir: root.path, namespace: root.namespace }))
    },

    mcpServers() {
      return loadOutcome()
        .effectiveMcpServers()
        .map((server) => toMcpServerConfig(server))
    },

    hookSources() {
      return loadOutcome()
        .effectiveHookPaths()
        .map((path) => ({ source: 'managed' as const, path }))
    },

    capabilitySummaries() {
      return loadOutcome()
        .plugins.filter(
          (plugin) => plugin.enabled && plugin.error === undefined && plugin.root !== null
        )
        .map((plugin) => ({
          name: plugin.manifestName ?? plugin.id.pluginName,
          ...(plugin.manifestDescription ? { description: plugin.manifestDescription } : {}),
          hasSkills: plugin.skillRoot !== null,
          mcpServerNames: plugin.mcpServers.map((server) => server.name)
        }))
    },

    onContributionsChanged(listener) {
      changeListeners.add(listener)
      return () => {
        changeListeners.delete(listener)
      }
    },

    reload: snapshot,

    listMarketplaceSources() {
      return deps.installer ? deps.installer.list().map(toSourceSummary) : []
    },

    async addMarketplace(input) {
      const outcome = await requireInstaller().add(input)

      emitChanged()
      return {
        name: outcome.name,
        sourceType: outcome.sourceType,
        sourceDisplay: outcome.sourceDisplay,
        alreadyAdded: outcome.alreadyAdded
      }
    },

    removeMarketplace(name) {
      const installer = requireInstaller()
      installer.remove(name)
      emitChanged()
      return installer.list().map(toSourceSummary)
    },

    async upgradeMarketplace(name) {
      const outcome = await requireInstaller().upgrade(name)
      if (outcome.updated) emitChanged()
      return outcome
    }
  }
}
