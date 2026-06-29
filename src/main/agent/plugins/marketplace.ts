/**
 * Parse a `marketplace.json` catalog.
 *
 * Wire-compatible with Codex (`codex-rs/core-plugins/src/marketplace.rs`):
 * - The catalog lives at `<root>/.agents/plugins/marketplace.json`, with a
 *   compatibility fallback to `<root>/.claude-plugin/marketplace.json`.
 * - `plugins[]` entries carry a `name`, a `source`, a `policy`, and a display
 *   `category`. Only `local` sources are supported here (the project scope
 *   excludes git/remote); entries with any other source are skipped.
 * - A local `source.path` (or the bare-string shorthand) must start with `./`,
 *   contain only normal path segments (no `..`), and resolve relative to the
 *   marketplace *root* — i.e. the directory the manifest-relative suffix is
 *   stripped from, not the directory the manifest file sits in.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type { Logger } from '../logging'
import { loadPluginManifest } from './manifest'
import { validatePluginSegment } from './plugin-id'

const MARKETPLACE_MANIFEST_RELATIVE_PATHS = [
  join('.agents', 'plugins', 'marketplace.json'),
  join('.claude-plugin', 'marketplace.json')
]

export type MarketplaceInstallPolicy = 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT'
export type MarketplaceAuthPolicy = 'ON_INSTALL' | 'ON_USE'

/** Resolved plugin source. Only local sources are supported in this scope. */
export interface MarketplacePluginLocalSource {
  kind: 'local'
  /** Absolute path to the local plugin source directory. */
  path: string
}

export interface MarketplacePlugin {
  /** Plugin name; matches the plugin folder and its `plugin.json` `name`. */
  name: string
  source: MarketplacePluginLocalSource
  /** Version read from the resolved plugin's own `plugin.json`, if present. */
  localVersion?: string
  installation: MarketplaceInstallPolicy
  authentication: MarketplaceAuthPolicy
  category?: string
}

export interface Marketplace {
  name: string
  /** Absolute path to the marketplace.json file. */
  path: string
  displayName?: string
  plugins: MarketplacePlugin[]
}

interface RawMarketplace {
  name?: unknown
  interface?: unknown
  plugins?: unknown
}

interface RawPluginEntry {
  name?: unknown
  source?: unknown
  policy?: unknown
  category?: unknown
}

const INSTALL_POLICIES = new Set<MarketplaceInstallPolicy>([
  'NOT_AVAILABLE',
  'AVAILABLE',
  'INSTALLED_BY_DEFAULT'
])
const AUTH_POLICIES = new Set<MarketplaceAuthPolicy>(['ON_INSTALL', 'ON_USE'])

/**
 * Find the marketplace manifest under a root directory, honoring the fallback
 * path. Returns the absolute manifest path, or null when none exists.
 */
export function findMarketplacePath(root: string): string | null {
  for (const relative of MARKETPLACE_MANIFEST_RELATIVE_PATHS) {
    const candidate = join(root, relative)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Given a marketplace.json path, derive the marketplace root by stripping the
 * known manifest-relative suffix. Local plugin paths resolve against this root.
 */
export function marketplaceRootDir(marketplacePath: string): string | null {
  const normalized = normalize(marketplacePath)
  for (const relative of MARKETPLACE_MANIFEST_RELATIVE_PATHS) {
    const suffix = sep + relative
    if (normalized.endsWith(suffix)) {
      return normalized.slice(0, normalized.length - suffix.length)
    }
    if (normalized === relative) return '.'
  }
  return null
}

function resolveLocalSourcePath(
  marketplaceRoot: string,
  rawPath: string,
  logger: Logger
): string | null {
  if (!rawPath.startsWith('./')) {
    logger.warn('skipping marketplace plugin: local source path must start with `./`')
    return null
  }
  const relative = rawPath.slice(2)
  if (relative.length === 0) {
    logger.warn('skipping marketplace plugin: local source path must not be empty')
    return null
  }
  const segments = normalize(relative).split(sep)
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      logger.warn('skipping marketplace plugin: source path must stay within the marketplace root')
      return null
    }
  }
  return join(marketplaceRoot, relative)
}

/**
 * Resolve a plugin entry's `source` to a local source path, or null when the
 * source is unsupported (git/remote) or malformed.
 */
function resolveSource(marketplaceRoot: string, source: unknown, logger: Logger): string | null {
  // Bare-string shorthand: `"source": "./plugins/foo"`.
  if (typeof source === 'string') {
    return resolveLocalSourcePath(marketplaceRoot, source, logger)
  }
  if (typeof source === 'object' && source !== null) {
    const obj = source as Record<string, unknown>
    if (obj.source === 'local' && typeof obj.path === 'string') {
      return resolveLocalSourcePath(marketplaceRoot, obj.path, logger)
    }
    // `url` / `git-subdir` sources are intentionally unsupported in this scope.
    logger.warn('skipping marketplace plugin with unsupported (non-local) source')
    return null
  }
  return null
}

function parsePolicy(value: unknown): {
  installation: MarketplaceInstallPolicy
  authentication: MarketplaceAuthPolicy
} {
  const obj = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const installation =
    typeof obj.installation === 'string' && INSTALL_POLICIES.has(obj.installation as never)
      ? (obj.installation as MarketplaceInstallPolicy)
      : 'AVAILABLE'
  const authentication =
    typeof obj.authentication === 'string' && AUTH_POLICIES.has(obj.authentication as never)
      ? (obj.authentication as MarketplaceAuthPolicy)
      : 'ON_INSTALL'
  return { installation, authentication }
}

/**
 * Load and parse a marketplace.json. Returns null when the file is missing or
 * unparseable, or when it lacks a usable `name`. Invalid plugin entries are
 * skipped with a warning rather than failing the whole catalog.
 */
export function loadMarketplace(marketplacePath: string, logger: Logger): Marketplace | null {
  let raw: RawMarketplace
  try {
    raw = JSON.parse(readFileSync(marketplacePath, 'utf8')) as RawMarketplace
  } catch (error) {
    logger.warn(`failed to parse marketplace ${marketplacePath}`, error)
    return null
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
  if (!name) {
    logger.warn(`ignoring marketplace ${marketplacePath}: missing name`)
    return null
  }

  const root = marketplaceRootDir(marketplacePath)
  if (root === null) {
    logger.warn(`ignoring marketplace ${marketplacePath}: not under a supported layout`)
    return null
  }

  const displayName =
    typeof raw.interface === 'object' &&
    raw.interface !== null &&
    typeof (raw.interface as Record<string, unknown>).displayName === 'string'
      ? ((raw.interface as Record<string, unknown>).displayName as string)
      : undefined

  const plugins: MarketplacePlugin[] = []
  if (Array.isArray(raw.plugins)) {
    for (const entry of raw.plugins as RawPluginEntry[]) {
      if (typeof entry !== 'object' || entry === null) continue
      const pluginName = typeof entry.name === 'string' ? entry.name.trim() : ''
      if (!pluginName) {
        logger.warn(`skipping marketplace plugin with no name in ${marketplacePath}`)
        continue
      }
      // The plugin name doubles as a PluginId segment and a cache directory
      // name, so it must satisfy the same strict charset.
      const nameError = validatePluginSegment(pluginName, 'plugin name')
      if (nameError) {
        logger.warn(`skipping marketplace plugin in ${marketplacePath}: ${nameError}`)
        continue
      }
      const sourcePath = resolveSource(root, entry.source, logger)
      if (!sourcePath) continue
      const policy = parsePolicy(entry.policy)
      const manifest = loadPluginManifest(sourcePath, logger)
      plugins.push({
        name: pluginName,
        source: { kind: 'local', path: sourcePath },
        ...(manifest?.version ? { localVersion: manifest.version } : {}),
        installation: policy.installation,
        authentication: policy.authentication,
        ...(typeof entry.category === 'string' && entry.category.trim()
          ? { category: entry.category.trim() }
          : {})
      })
    }
  }

  return {
    name,
    path: marketplacePath,
    ...(displayName ? { displayName } : {}),
    plugins
  }
}
