import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseHooksConfig } from './config'
import type { HookEntry, HookSource } from './types'

export interface DiscoverInput {
  cwd: string
  userDir?: string

  pluginSources?: { source: HookSource; path: string }[]
}

export interface DiscoverResult {
  entries: HookEntry[]
  warnings: string[]
}

interface Layer {
  source: HookSource
  path: string
}

function readJsonFile(path: string): unknown | undefined {
  try {
    const content = readFileSync(path, 'utf8')
    if (!content.trim()) return undefined
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

export function discoverHooks(input: DiscoverInput): DiscoverResult {
  const layers: Layer[] = []

  if (input.userDir) layers.push({ source: 'user', path: join(input.userDir, 'hooks.json') })
  layers.push({ source: 'user', path: join(homedir(), '.tanzo', 'hooks.json') })
  layers.push({ source: 'project', path: join(input.cwd, '.tanzo', 'hooks.json') })

  for (const pluginSource of input.pluginSources ?? []) layers.push(pluginSource)

  const entries: HookEntry[] = []
  const warnings: string[] = []
  let order = 0

  for (const layer of layers) {
    const raw = readJsonFile(layer.path)
    if (raw === undefined) continue
    const parsed = parseHooksConfig({
      raw,
      source: layer.source,
      keySource: layer.path,
      configPath: layer.path,
      displayOrderStart: order
    })
    entries.push(...parsed.entries)
    warnings.push(...parsed.warnings)
    order += parsed.entries.length
  }

  return { entries, warnings }
}
