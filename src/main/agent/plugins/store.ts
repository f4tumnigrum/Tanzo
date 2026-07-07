import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TanzoValidationError } from '@shared/errors'
import { loadPluginManifest } from './manifest'
import { makePluginId, pluginIdKey, validatePluginSegment, type PluginId } from './plugin-id'
import type { Logger } from '../logging'

export const DEFAULT_PLUGIN_VERSION = 'local'
export const PLUGINS_CACHE_DIR = join('plugins', 'cache')
export const PLUGINS_DATA_DIR = join('plugins', 'data')

const VERSION_SEGMENT_RE = /^[A-Za-z0-9._+-]+$/

export interface PluginInstallResult {
  id: PluginId
  version: string
  installedPath: string
}

export interface PluginStore {
  cacheRoot(): string

  pluginBaseRoot(id: PluginId): string

  pluginRoot(id: PluginId, version: string): string

  pluginDataRoot(id: PluginId): string

  activePluginVersion(id: PluginId): string | undefined

  activePluginRoot(id: PluginId): string | undefined
  isInstalled(id: PluginId): boolean

  listInstalled(): PluginId[]

  install(sourcePath: string, id: PluginId): PluginInstallResult
  uninstall(id: PluginId): void
}

export function validatePluginVersionSegment(version: string): string | null {
  if (version.length === 0) return 'invalid plugin version: must not be empty'
  if (version === '.' || version === '..') {
    return 'invalid plugin version: path traversal is not allowed'
  }
  if (!VERSION_SEGMENT_RE.test(version)) {
    return 'invalid plugin version: only ASCII letters, digits, `.`, `+`, `_`, and `-` are allowed'
  }
  return null
}

function parseSemver(version: string): number[] | null {
  const core = version.split(/[-+]/, 1)[0]
  const parts = core.split('.')
  if (parts.length === 0) return null
  const nums: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    nums.push(Number(part))
  }
  return nums
}

export function comparePluginVersions(left: string, right: string): number {
  const l = parseSemver(left)
  const r = parseSemver(right)
  if (l && r) {
    const len = Math.max(l.length, r.length)
    for (let i = 0; i < len; i++) {
      const diff = (l[i] ?? 0) - (r[i] ?? 0)
      if (diff !== 0) return diff < 0 ? -1 : 1
    }
    return 0
  }
  return left < right ? -1 : left > right ? 1 : 0
}

export function createPluginStore(root: string, logger: Logger): PluginStore {
  const cacheRoot = join(root, PLUGINS_CACHE_DIR)
  const dataRoot = join(root, PLUGINS_DATA_DIR)

  function pluginBaseRoot(id: PluginId): string {
    return join(cacheRoot, id.marketplaceName, id.pluginName)
  }

  function pluginRoot(id: PluginId, version: string): string {
    return join(pluginBaseRoot(id), version)
  }

  function activePluginVersion(id: PluginId): string | undefined {
    const base = pluginBaseRoot(id)
    let entries: string[]
    try {
      entries = readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => validatePluginVersionSegment(name) === null)
    } catch {
      return undefined
    }
    if (entries.length === 0) return undefined
    if (entries.includes(DEFAULT_PLUGIN_VERSION)) return DEFAULT_PLUGIN_VERSION
    entries.sort(comparePluginVersions)
    return entries[entries.length - 1]
  }

  function listInstalled(): PluginId[] {
    let marketplaces: string[]
    try {
      marketplaces = readdirSync(cacheRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
    const ids: PluginId[] = []
    for (const marketplaceName of marketplaces) {
      let pluginNames: string[]
      try {
        pluginNames = readdirSync(join(cacheRoot, marketplaceName), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch {
        continue
      }
      for (const pluginName of pluginNames) {
        const result = makePluginId(pluginName, marketplaceName)
        if (result.ok && activePluginVersion(result.id) !== undefined) ids.push(result.id)
      }
    }
    return ids
  }

  function install(sourcePath: string, id: PluginId): PluginInstallResult {
    let isDir = false
    try {
      isDir = statSync(sourcePath).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      throw new TanzoValidationError(
        'PLUGIN_SOURCE_INVALID',
        `Plugin source path is not a directory: ${sourcePath}`
      )
    }

    const manifest = loadPluginManifest(sourcePath, logger)
    if (!manifest) {
      throw new TanzoValidationError(
        'PLUGIN_MANIFEST_MISSING',
        `No plugin.json found in "${sourcePath}".`
      )
    }
    const nameError = validatePluginSegment(manifest.name, 'plugin name')
    if (nameError) {
      throw new TanzoValidationError('PLUGIN_NAME_INVALID', `${nameError} in "${sourcePath}".`)
    }
    if (manifest.name !== id.pluginName) {
      throw new TanzoValidationError(
        'PLUGIN_NAME_MISMATCH',
        `plugin.json name "${manifest.name}" does not match marketplace plugin name "${id.pluginName}".`
      )
    }

    const version = manifest.version ?? DEFAULT_PLUGIN_VERSION
    const versionError = validatePluginVersionSegment(version)
    if (versionError) {
      throw new TanzoValidationError(
        'PLUGIN_VERSION_INVALID',
        `${versionError} in "${sourcePath}".`
      )
    }

    const installedPath = pluginRoot(id, version)

    const base = pluginBaseRoot(id)
    mkdirSync(base, { recursive: true })
    const staged = join(base, `.staging-${process.pid}-${Date.now().toString(36)}`)
    rmSync(staged, { recursive: true, force: true })
    try {
      cpSync(sourcePath, staged, { recursive: true })
      rmSync(installedPath, { recursive: true, force: true })
      renameSync(staged, installedPath)
    } finally {
      rmSync(staged, { recursive: true, force: true })
    }

    return { id, version, installedPath }
  }

  return {
    cacheRoot: () => cacheRoot,
    pluginBaseRoot,
    pluginRoot,
    pluginDataRoot: (id) => join(dataRoot, `${id.pluginName}-${id.marketplaceName}`),
    activePluginVersion,
    activePluginRoot(id) {
      const version = activePluginVersion(id)
      return version ? pluginRoot(id, version) : undefined
    },
    isInstalled: (id) => activePluginVersion(id) !== undefined,
    listInstalled,
    install,
    uninstall(id) {
      rmSync(pluginBaseRoot(id), { recursive: true, force: true })
    }
  }
}

export function pluginStoreKey(pluginName: string, marketplaceName: string): string | null {
  const result = makePluginId(pluginName, marketplaceName)
  return result.ok ? pluginIdKey(result.id) : null
}
