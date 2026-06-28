import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TanzoValidationError } from '@shared/errors'
import {
  comparePluginVersions,
  createPluginStore,
  validatePluginVersionSegment,
  type PluginStore
} from '@main/agent/plugins/store'
import type { PluginId } from '@main/agent/plugins/plugin-id'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tanzo-plugin-store-'))
  tempDirs.push(dir)
  return dir
}

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

function writePluginSource(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(dir, '.codex-plugin'), { recursive: true })
  writeFileSync(join(dir, '.codex-plugin', 'plugin.json'), JSON.stringify(manifest))
}

const id = (pluginName: string, marketplaceName = 'personal'): PluginId => ({
  pluginName,
  marketplaceName
})

describe('main/agent/plugins/store version helpers', () => {
  it('validates version segments', () => {
    expect(validatePluginVersionSegment('1.2.3')).toBeNull()
    expect(validatePluginVersionSegment('1.2.3-beta+7')).toBeNull()
    expect(validatePluginVersionSegment('local')).toBeNull()
    expect(validatePluginVersionSegment('')).toMatch(/must not be empty/)
    expect(validatePluginVersionSegment('..')).toMatch(/path traversal/)
    expect(validatePluginVersionSegment('1/2')).toMatch(/only ASCII/)
  })

  it('orders by semver, falling back to string order', () => {
    expect(comparePluginVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(comparePluginVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(comparePluginVersions('1.0.0', '1.0.0')).toBe(0)
    // non-semver tags fall back to string comparison
    expect(comparePluginVersions('alpha', 'beta')).toBeLessThan(0)
  })
})

describe('main/agent/plugins/store', () => {
  function setup(): { store: PluginStore; root: string } {
    const root = tempDir()
    return { store: createPluginStore(root, silentLogger), root }
  }

  it('computes Codex-compatible cache and data paths', () => {
    const { store, root } = setup()
    expect(store.pluginBaseRoot(id('linear'))).toBe(
      join(root, 'plugins', 'cache', 'personal', 'linear')
    )
    expect(store.pluginRoot(id('linear'), '1.0.0')).toBe(
      join(root, 'plugins', 'cache', 'personal', 'linear', '1.0.0')
    )
    expect(store.pluginDataRoot(id('linear'))).toBe(
      join(root, 'plugins', 'data', 'linear-personal')
    )
  })

  it('installs a plugin source and resolves it as the active version', () => {
    const { store } = setup()
    const source = tempDir()
    writePluginSource(source, { name: 'linear', version: '1.0.0' })

    const result = store.install(source, id('linear'))
    expect(result.version).toBe('1.0.0')
    expect(store.isInstalled(id('linear'))).toBe(true)
    expect(store.activePluginVersion(id('linear'))).toBe('1.0.0')
    expect(store.activePluginRoot(id('linear'))).toBe(result.installedPath)
  })

  it('defaults to the `local` version when the manifest omits one', () => {
    const { store } = setup()
    const source = tempDir()
    writePluginSource(source, { name: 'demo' })
    const result = store.install(source, id('demo'))
    expect(result.version).toBe('local')
  })

  it('prefers the `local` version over numbered versions', () => {
    const { store } = setup()
    const v1 = tempDir()
    writePluginSource(v1, { name: 'demo', version: '1.0.0' })
    store.install(v1, id('demo'))
    const local = tempDir()
    writePluginSource(local, { name: 'demo' }) // no version => local
    store.install(local, id('demo'))
    expect(store.activePluginVersion(id('demo'))).toBe('local')
  })

  it('rejects a source whose manifest name does not match the plugin id', () => {
    const { store } = setup()
    const source = tempDir()
    writePluginSource(source, { name: 'other', version: '1.0.0' })
    expect(() => store.install(source, id('linear'))).toThrow(TanzoValidationError)
  })

  it('rejects a source directory with no manifest', () => {
    const { store } = setup()
    const source = tempDir()
    expect(() => store.install(source, id('linear'))).toThrow(/No plugin.json/)
  })

  it('rejects a non-existent source path', () => {
    const { store } = setup()
    expect(() => store.install(join(tempDir(), 'missing'), id('linear'))).toThrow(/not a directory/)
  })

  it('uninstall removes all installed versions', () => {
    const { store } = setup()
    const source = tempDir()
    writePluginSource(source, { name: 'demo', version: '1.0.0' })
    store.install(source, id('demo'))
    expect(store.isInstalled(id('demo'))).toBe(true)
    store.uninstall(id('demo'))
    expect(store.isInstalled(id('demo'))).toBe(false)
    expect(store.activePluginRoot(id('demo'))).toBeUndefined()
  })

  it('reinstalling a different version replaces the active root contents', () => {
    const { store } = setup()
    const v1 = tempDir()
    writePluginSource(v1, { name: 'demo', version: '1.0.0' })
    writeFileSync(join(v1, 'marker-v1.txt'), 'v1')
    store.install(v1, id('demo'))

    const v2 = tempDir()
    writePluginSource(v2, { name: 'demo', version: '2.0.0' })
    store.install(v2, id('demo'))

    // highest semver is active when no `local` version exists
    expect(store.activePluginVersion(id('demo'))).toBe('2.0.0')
  })
})
