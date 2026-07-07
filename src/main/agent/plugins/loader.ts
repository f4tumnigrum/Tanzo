import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Logger } from '../logging'
import { loadPluginManifest, type PluginManifest } from './manifest'
import { pluginIdKey, type PluginId } from './plugin-id'
import type { PluginStore } from './store'

const DEFAULT_SKILLS_DIR = 'skills'
const DEFAULT_MCP_CONFIG = '.mcp.json'
const DEFAULT_HOOKS_CONFIG = join('hooks', 'hooks.json')

export interface PluginMcpServer {
  name: string

  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

export interface PluginSkillRoot {
  path: string

  pluginId: string

  namespace: string

  pluginRoot: string
}

export interface LoadedPlugin {
  configKey: string
  id: PluginId

  root: string | null
  enabled: boolean
  manifestName?: string
  manifestDescription?: string

  skillRoot: string | null
  mcpServers: PluginMcpServer[]

  hooksPath: string | null
  error?: string
}

export interface ConfiguredPlugin {
  id: PluginId
  enabled: boolean
}

export interface PluginLoadOutcome {
  plugins: LoadedPlugin[]

  effectiveSkillRoots(): PluginSkillRoot[]

  effectiveMcpServers(): PluginMcpServer[]

  effectiveHookPaths(): string[]
}

function isActive(plugin: LoadedPlugin): boolean {
  return plugin.enabled && plugin.error === undefined && plugin.root !== null
}

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
      server.cwd = isAbsolute(obj.cwd) ? obj.cwd : join(pluginRoot, obj.cwd)
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

function contributionPath(
  pluginRoot: string,
  manifestPath: string | null,
  defaultRelative: string
): string | null {
  const candidate = manifestPath ?? join(pluginRoot, defaultRelative)
  return existsSync(candidate) ? candidate : null
}

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

export function loadPlugins(
  configured: ConfiguredPlugin[],
  store: PluginStore,
  logger: Logger
): PluginLoadOutcome {
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
