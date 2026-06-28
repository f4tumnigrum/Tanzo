import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseHooksConfig } from './config'
import type { HookEntry, HookSource } from './types'

/**
 * Discovers hook config across layers, lowest precedence first (Codex
 * `discovery.rs`): user/global → project. Each layer's `hooks.json` is parsed
 * and entries get a monotonic display order preserved during aggregation.
 *
 * v1 supports JSON config only (`hooks.json`); the TOML `[hooks]` form is not
 * yet supported (see docs/architecture/14-hooks.md §2).
 */

export interface DiscoverInput {
  cwd: string
  userDir?: string
  /**
   * Hook config files contributed by active plugins. Registered as `managed`
   * layers (highest precedence) so they run without manual trust — mirroring
   * the "install = consent" model. The plugin manager owns this list.
   */
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
  // User/global layer (lowest precedence).
  if (input.userDir) layers.push({ source: 'user', path: join(input.userDir, 'hooks.json') })
  layers.push({ source: 'user', path: join(homedir(), '.tanzo', 'hooks.json') })
  layers.push({ source: 'project', path: join(input.cwd, '.tanzo', 'hooks.json') })
  // Plugin-contributed hook configs (managed; highest precedence).
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
