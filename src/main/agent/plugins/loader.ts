/**
 * Assemble a plugin's contributions (skills, MCP servers, hooks) from its
 * installed cache root.
 *
 * Wire-compatible with Codex (`codex-rs/core-plugins/src/loader.rs` +
 * `codex-rs/plugin/src/load_outcome.rs`):
 * - Only *active* plugins (enabled and error-free) contribute.
 * - Skill roots are deduplicated; when two plugins declare the same root, the
 *   first-seen plugin owns it (sorted by path for determinism).
 * - MCP server names collide first-wins; later duplicates are dropped.
 * - A plugin's default contribution paths are supplemented by its manifest:
 *   `skills` defaults to `<root>/skills`, `mcpServers` to `<root>/.mcp.json`,
 *   `hooks` to `<root>/hooks/hooks.json`, each overridable by the manifest.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../logging'
import { loadPluginManifest, type PluginManifest } from './manifest'
import { pluginIdKey, type PluginId } from './plugin-id'
import type { PluginStore } from './store'

const DEFAULT_SKILLS_DIR = 'skills'
const DEFAULT_MCP_CONFIG = '.mcp.json'
const DEFAULT_HOOKS_CONFIG = join('hooks', 'hooks.json')

/** A single MCP server declared by a plugin, in a transport-agnostic shape. */
export interface PluginMcpServer {
  name: string
  /** Codex `.mcp.json` transport tag (`stdio` | `http` | `streamable_http` | ...). */
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

/** A skills directory contributed by a plugin, tagged with its namespace. */
export interface PluginSkillRoot {
  /** Absolute path to the skills directory. */
  path: string
  /** The plugin's `<plugin>@<marketplace>` config key. */
  pluginId: string
  /** Namespace prefix for the plugin's skills (its manifest name). */
  namespace: string
  /** Absolute path to the plugin root. */
  pluginRoot: string
}

/** A plugin resolved from disk, with its assembled contributions. */
export interface LoadedPlugin {
  /** `<plugin>@<marketplace>` config key. */
  configKey: string
  id: PluginId
  /** Active version's plugin root, or null when not installed. */
  root: string | null
  enabled: boolean
  manifestName?: string
  manifestDescription?: string
  /** Absolute skills directory, when one exists. */
  skillRoot: string | null
  mcpServers: PluginMcpServer[]
  /** Absolute hooks config path, when one exists. */
  hooksPath: string | null
  error?: string
}

export interface ConfiguredPlugin {
  id: PluginId
  enabled: boolean
}

export interface PluginLoadOutcome {
  plugins: LoadedPlugin[]
  /** Namespaced skill roots from active plugins, deduped first-wins by path. */
  effectiveSkillRoots(): PluginSkillRoot[]
  /** MCP servers from active plugins, first-wins on name collision. */
  effectiveMcpServers(): PluginMcpServer[]
  /** Hook config paths from active plugins. */
  effectiveHookPaths(): string[]
}

function isActive(plugin: LoadedPlugin): boolean {
  return plugin.enabled && plugin.error === undefined && plugin.root !== null
}

/**
 * Read a plugin's `.mcp.json`, accepting both the `{ mcpServers: {...} }`
 * wrapper and a bare `{ name: config }` map. Relative `cwd` values are resolved
 * against the plugin root, mirroring Codex's normalization.
 */
export function loadPluginMcpServers(
  pluginRoot: string,
  mcpConfigPath: string,
  logger: Logger
): PluginMcpServer[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(mcpConfigPath, 'utf8'))
  } catch (error) {
    logger.warn(`failed to parse plugin MCP config ${mcpConfigPath}`, error)
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []

  const record = parsed as Record<string, unknown>
  const serverMap =
    typeof record.mcpServers === 'object' && record.mcpServers !== null
      ? (record.mcpServers as Record<string, unknown>)
      : record

  const servers: PluginMcpServer[] = []
  for (const [name, raw] of Object.entries(serverMap)) {
    if (typeof raw !== 'object' || raw === null) continue
    const obj = raw as Record<string, unknown>
    const server: PluginMcpServer = { name }

    if (typeof obj.type === 'string') server.type = obj.type
    if (typeof obj.command === 'string') server.command = obj.command
    if (Array.isArray(obj.args)) {
      server.args = obj.args.filter((item): item is string => typeof item === 'string')
    }
    if (typeof obj.url === 'string') server.url = obj.url
    const env = stringRecord(obj.env)
    if (env) server.env = env
    const headers = stringRecord(obj.headers)
    if (headers) server.headers = headers
    if (typeof obj.cwd === 'string') {
      // Resolve a relative cwd against the plugin root (Codex behavior).
      server.cwd = obj.cwd.startsWith('/') ? obj.cwd : join(pluginRoot, obj.cwd)
    }

    servers.push(server)
  }
  return servers
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Resolve a manifest-declared path or fall back to a default under the root. */
function contributionPath(
  pluginRoot: string,
  manifestPath: string | null,
  defaultRelative: string
): string | null {
  const candidate = manifestPath ?? join(pluginRoot, defaultRelative)
  return existsSync(candidate) ? candidate : null
}

/** Resolve and assemble one configured plugin's contributions. */
export function loadPlugin(
  configured: ConfiguredPlugin,
  store: PluginStore,
  logger: Logger
): LoadedPlugin {
  const configKey = pluginIdKey(configured.id)
  const root = store.activePluginRoot(configured.id) ?? null
  const base: LoadedPlugin = {
    configKey,
    id: configured.id,
    root,
    enabled: configured.enabled,
    skillRoot: null,
    mcpServers: [],
    hooksPath: null
  }

  if (root === null) {
    return { ...base, error: 'plugin is not installed' }
  }

  let manifest: PluginManifest | null
  try {
    manifest = loadPluginManifest(root, logger)
  } catch (error) {
    logger.warn(`failed to load plugin manifest for ${configKey}`, error)
    return { ...base, error: 'failed to load plugin manifest' }
  }
  if (!manifest) {
    return { ...base, error: 'plugin.json not found' }
  }

  const skillRoot = contributionPath(root, manifest.paths.skills, DEFAULT_SKILLS_DIR)
  const mcpConfigPath = contributionPath(root, manifest.paths.mcpServers, DEFAULT_MCP_CONFIG)
  const hooksPath = contributionPath(root, manifest.paths.hooks, DEFAULT_HOOKS_CONFIG)

  return {
    ...base,
    ...(manifest.name ? { manifestName: manifest.name } : {}),
    ...(manifest.description ? { manifestDescription: manifest.description } : {}),
    skillRoot,
    mcpServers: mcpConfigPath ? loadPluginMcpServers(root, mcpConfigPath, logger) : [],
    hooksPath
  }
}

/** Load all configured plugins and expose their effective aggregate contributions. */
export function loadPlugins(
  configured: ConfiguredPlugin[],
  store: PluginStore,
  logger: Logger
): PluginLoadOutcome {
  // Sort by config key so collision resolution (first-wins) is deterministic.
  const sorted = [...configured].sort((a, b) => {
    const ka = pluginIdKey(a.id)
    const kb = pluginIdKey(b.id)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  const plugins = sorted.map((entry) => loadPlugin(entry, store, logger))

  for (const plugin of plugins) {
    if (plugin.error) {
      logger.warn(`plugin ${plugin.configKey} failed to load: ${plugin.error}`)
    }
  }

  return {
    plugins,
    effectiveSkillRoots() {
      const seen = new Set<string>()
      const roots: PluginSkillRoot[] = []
      for (const plugin of plugins) {
        if (!isActive(plugin) || plugin.skillRoot === null) continue
        if (seen.has(plugin.skillRoot)) continue
        seen.add(plugin.skillRoot)
        roots.push({
          path: plugin.skillRoot,
          pluginId: plugin.configKey,
          namespace: plugin.manifestName ?? plugin.id.pluginName,
          pluginRoot: plugin.root as string
        })
      }
      return roots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    },
    effectiveMcpServers() {
      const byName = new Map<string, PluginMcpServer>()
      for (const plugin of plugins) {
        if (!isActive(plugin)) continue
        for (const server of plugin.mcpServers) {
          if (byName.has(server.name)) {
            logger.warn(
              `skipping duplicate plugin MCP server name "${server.name}" from ${plugin.configKey}`
            )
            continue
          }
          byName.set(server.name, server)
        }
      }
      return [...byName.values()]
    },
    effectiveHookPaths() {
      const paths: string[] = []
      for (const plugin of plugins) {
        if (isActive(plugin) && plugin.hooksPath !== null) paths.push(plugin.hooksPath)
      }
      return paths
    }
  }
}
