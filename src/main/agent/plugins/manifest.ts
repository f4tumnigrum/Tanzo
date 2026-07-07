import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'
import type { Logger } from '../logging'

const DISCOVERABLE_MANIFEST_PATHS = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']

const MAX_DEFAULT_PROMPT_COUNT = 3
const MAX_DEFAULT_PROMPT_LEN = 128

export interface PluginManifestPaths {
  skills: string | null

  mcpServers: string | null

  apps: string | null

  hooks: string | null
}

export interface PluginManifestInterface {
  displayName?: string
  shortDescription?: string
  longDescription?: string
  developerName?: string
  category?: string
  capabilities: string[]
  websiteUrl?: string
  privacyPolicyUrl?: string
  termsOfServiceUrl?: string
  defaultPrompt?: string[]
  brandColor?: string
  composerIcon: string | null
  logo: string | null
  screenshots: string[]
}

export interface PluginManifest {
  name: string
  version?: string
  description?: string
  keywords: string[]
  paths: PluginManifestPaths
  interface?: PluginManifestInterface
}

interface RawManifest {
  name?: unknown
  version?: unknown
  description?: unknown
  keywords?: unknown
  skills?: unknown
  mcpServers?: unknown
  apps?: unknown
  hooks?: unknown
  interface?: unknown
}

export function findManifestPath(pluginRoot: string): string | null {
  for (const relative of DISCOVERABLE_MANIFEST_PATHS) {
    const candidate = join(pluginRoot, relative)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function loadPluginManifest(pluginRoot: string, logger: Logger): PluginManifest | null {
  const manifestPath = findManifestPath(pluginRoot)
  if (!manifestPath) return null

  let raw: RawManifest
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as RawManifest
  } catch (error) {
    logger.warn(`failed to parse plugin manifest ${manifestPath}`, error)
    return null
  }

  const rawName = typeof raw.name === 'string' ? raw.name.trim() : ''

  const name = rawName || basename(pluginRoot)
  const version =
    typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : undefined
  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim()
      : undefined
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.filter((item): item is string => typeof item === 'string')
    : []

  return {
    name,
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
    keywords,
    paths: {
      skills: resolveManifestPath(pluginRoot, 'skills', raw.skills, logger),
      mcpServers: resolveManifestPath(pluginRoot, 'mcpServers', raw.mcpServers, logger),
      apps: resolveManifestPath(pluginRoot, 'apps', raw.apps, logger),
      hooks: resolveManifestPath(pluginRoot, 'hooks', raw.hooks, logger)
    },
    ...(parseInterface(pluginRoot, raw.interface, logger) ?? {})
  }
}

function basename(p: string): string {
  const parts = normalize(p).split(sep).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

export function resolveManifestPath(
  pluginRoot: string,
  field: string,
  value: unknown,
  logger: Logger
): string | null {
  if (value == null) return null
  if (typeof value !== 'string') {
    logger.warn(`ignoring plugin ${field}: expected a string path`)
    return null
  }
  if (value.length === 0) return null
  if (!value.startsWith('./')) {
    logger.warn(`ignoring plugin ${field}: path must start with \`./\` relative to plugin root`)
    return null
  }
  const relative = value.slice(2)
  if (relative.length === 0) {
    logger.warn(`ignoring plugin ${field}: path must not be \`./\``)
    return null
  }

  const segments = normalize(relative).split(sep)
  for (const segment of segments) {
    if (segment === '..') {
      logger.warn(`ignoring plugin ${field}: path must not contain '..'`)
      return null
    }
  }

  const resolved = join(pluginRoot, relative)
  const normalizedRoot = normalize(pluginRoot)
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep
  if (isAbsolute(relative) || (!resolved.startsWith(rootWithSep) && resolved !== normalizedRoot)) {
    logger.warn(`ignoring plugin ${field}: path must stay within the plugin root`)
    return null
  }
  return resolved
}

function parseInterface(
  pluginRoot: string,
  value: unknown,
  logger: Logger
): { interface: PluginManifestInterface } | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const str = (key: string): string | undefined => {
    const v = raw[key]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }

  const result: PluginManifestInterface = {
    ...optional('displayName', str('displayName')),
    ...optional('shortDescription', str('shortDescription')),
    ...optional('longDescription', str('longDescription')),
    ...optional('developerName', str('developerName')),
    ...optional('category', str('category')),
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    ...optional('websiteUrl', str('websiteURL')),
    ...optional('privacyPolicyUrl', str('privacyPolicyURL')),
    ...optional('termsOfServiceUrl', str('termsOfServiceURL')),
    ...optional('defaultPrompt', parseDefaultPrompt(raw.defaultPrompt, logger)),
    ...optional('brandColor', str('brandColor')),
    composerIcon: resolveManifestPath(
      pluginRoot,
      'interface.composerIcon',
      raw.composerIcon,
      logger
    ),
    logo: resolveManifestPath(pluginRoot, 'interface.logo', raw.logo, logger),
    screenshots: Array.isArray(raw.screenshots)
      ? raw.screenshots
          .map((item) => resolveManifestPath(pluginRoot, 'interface.screenshots', item, logger))
          .filter((item): item is string => item !== null)
      : []
  }

  const hasContent =
    result.displayName !== undefined ||
    result.shortDescription !== undefined ||
    result.longDescription !== undefined ||
    result.developerName !== undefined ||
    result.category !== undefined ||
    result.capabilities.length > 0 ||
    result.websiteUrl !== undefined ||
    result.privacyPolicyUrl !== undefined ||
    result.termsOfServiceUrl !== undefined ||
    result.defaultPrompt !== undefined ||
    result.brandColor !== undefined ||
    result.composerIcon !== null ||
    result.logo !== null ||
    result.screenshots.length > 0

  return hasContent ? { interface: result } : null
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

function parseDefaultPrompt(value: unknown, logger: Logger): string[] | undefined {
  const collapse = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ')

  const fromEntry = (entry: unknown): string | null => {
    if (typeof entry !== 'string') return null
    const prompt = collapse(entry)
    if (!prompt) return null
    if (prompt.length > MAX_DEFAULT_PROMPT_LEN) {
      logger.warn(`ignoring interface.defaultPrompt entry: exceeds ${MAX_DEFAULT_PROMPT_LEN} chars`)
      return null
    }
    return prompt
  }

  if (typeof value === 'string') {
    const single = fromEntry(value)
    return single ? [single] : undefined
  }
  if (Array.isArray(value)) {
    const prompts: string[] = []
    for (const entry of value) {
      if (prompts.length >= MAX_DEFAULT_PROMPT_COUNT) break
      const prompt = fromEntry(entry)
      if (prompt) prompts.push(prompt)
    }
    return prompts.length > 0 ? prompts : undefined
  }
  return undefined
}
