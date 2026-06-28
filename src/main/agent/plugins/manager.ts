/**
 * Plugin manager: discovery, lifecycle, and state, tying the plugin primitives
 * together for the rest of the app.
 *
 * Scope (per project decision): local marketplaces only — a personal
 * marketplace under the user's home and an optional workspace marketplace —
 * with a Tanzo-owned cache/data directory. Git and remote/curated marketplaces
 * are intentionally out of scope.
 *
 * Responsibilities:
 * - Discover plugins available in local `marketplace.json` catalogs.
 * - Install (copy into the cache) and uninstall plugins by `<plugin>@<market>`.
 * - Persist enable/disable + install metadata in the `plugin_states` table.
 * - Produce a `PluginLoadOutcome` of the active plugins' contributions for the
 *   wiring layer (skills / MCP / hooks).
 */

import { homedir } from 'node:os'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type {
  InstallPluginInput,
  MarketplacePluginEntry,
  PluginDetail,
  PluginSnapshot,
  PluginSummary
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

/**
 * Structured, prose-free summary of one active plugin's capabilities. The
 * context engine renders these into a catalog block and per-turn focus hints.
 * Mirrors Codex's `capability_summaries()`.
 */
export interface PluginCapabilitySummary {
  /** Namespace prefix for the plugin's skills (manifest name, else plugin name). */
  name: string
  description?: string
  /** Whether the plugin contributes a skills directory. */
  hasSkills: boolean
  /** MCP server names contributed by this plugin. */
  mcpServerNames: string[]
}

export interface PluginsManagerDeps {
  store: PluginStore
  state: PluginStateStore | null
  /** Directories to search for a `marketplace.json` (e.g. home, workspace). */
  marketplaceRoots: string[]
  logger: Logger
}

export interface PluginsManager {
  /** Snapshot of installed plugins with their enable state and contributions. */
  list(): PluginSnapshot
  detail(id: string): PluginDetail | null
  setEnabled(id: string, enabled: boolean): PluginSnapshot
  install(input: InstallPluginInput): PluginSnapshot
  uninstall(id: string): PluginSnapshot
  /** Plugins discoverable across the configured local marketplaces. */
  listMarketplacePlugins(): MarketplacePluginEntry[]
  /** Active plugins' assembled contributions, for the wiring layer. */
  loadOutcome(): PluginLoadOutcome
  // --- Typed contribution getters: the plugin system is a pure data source.
  // Each subsystem pulls from these lazily; the manager never reaches into a
  // subsystem. Re-evaluated on every call so enable/disable take effect.
  /** Namespaced skills directories from active plugins. */
  skillRoots(): { dir: string; namespace: string }[]
  /** MCP servers from active plugins, adapted to Tanzo's config shape. */
  mcpServers(): McpServerConfig[]
  /** Hook config sources from active plugins (always `managed`). */
  hookSources(): PluginHookSourceInput[]
  /**
   * Structured capability summaries for active (enabled) plugins, for the
   * context engine to render a plugin catalog and per-turn focus hints.
   * Mirrors Codex's `capability_summaries()`: pure data, no prose.
   */
  capabilitySummaries(): PluginCapabilitySummary[]
  /**
   * Subscribe to contribution changes (install/uninstall/enable/disable).
   * The composition root fans this out to the subsystems. Returns unsubscribe.
   */
  onContributionsChanged(listener: () => void): () => void
  reload(): PluginSnapshot
}

/** Default marketplace roots: the user's home `~/.agents/plugins` lives here. */
export function defaultMarketplaceRoots(workspaceRoot: string): string[] {
  return [homedir(), workspaceRoot]
}

export function createPluginsManager(deps: PluginsManagerDeps): PluginsManager {
  const { store, state, logger } = deps

  function discoverMarketplaces(): Marketplace[] {
    const found: Marketplace[] = []
    for (const root of deps.marketplaceRoots) {
      const path = findMarketplacePath(root)
      if (!path) continue
      const market = loadMarketplace(path, logger)
      if (market) found.push(market)
    }
    return found
  }

  /** Find a marketplace plugin entry by its `<plugin>@<marketplace>` key. */
  function findMarketplacePlugin(id: PluginId): MarketplacePlugin | undefined {
    for (const market of discoverMarketplaces()) {
      if (market.name !== id.marketplaceName) continue
      const entry = market.plugins.find((plugin) => plugin.name === id.pluginName)
      if (entry) return entry
    }
    return undefined
  }

  /**
   * Configured plugins = those recorded as installed in state. Enable defaults
   * to true when no state row says otherwise (mirrors skill enablement).
   */
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

  // Contribution-change subscribers (the composition root). A single event,
  // fanned out by the wiring layer, keeps this manager from reaching into any
  // subsystem.
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
          // Display metadata lives in the plugin's own manifest, not the
          // marketplace entry (mirrors Codex resolving the plugin interface).
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
      // Active = enabled, error-free, installed — same predicate the loader's
      // effective getters use. We summarize per-plugin (not aggregated) so the
      // context engine can name each plugin and its skill namespace.
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

    reload: snapshot
  }
}
