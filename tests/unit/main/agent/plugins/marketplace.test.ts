import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadMarketplace,
  marketplaceRootDir,
  type Marketplace
} from '@main/agent/plugins/marketplace'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tanzo-marketplace-'))
  tempDirs.push(dir)
  return dir
}

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

/**
 * Build a `.agents/plugins/marketplace.json` layout under a fresh root, plus a
 * local plugin at `<root>/plugins/<name>` with a valid manifest.
 */
function writeMarketplace(
  root: string,
  manifest: Record<string, unknown>,
  plugins: { name: string; version?: string }[] = []
): string {
  const dir = join(root, '.agents', 'plugins')
  mkdirSync(dir, { recursive: true })
  const marketplacePath = join(dir, 'marketplace.json')
  writeFileSync(marketplacePath, JSON.stringify(manifest))
  for (const plugin of plugins) {
    const pluginDir = join(root, 'plugins', plugin.name, '.codex-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: plugin.name, ...(plugin.version ? { version: plugin.version } : {}) })
    )
  }
  return marketplacePath
}

describe('main/agent/plugins/marketplace', () => {
  it('derives the marketplace root from the .agents/plugins layout', () => {
    const root = tempDir()
    const path = join(root, '.agents', 'plugins', 'marketplace.json')
    expect(marketplaceRootDir(path)).toBe(root)
  })

  it('derives the marketplace root from the .claude-plugin layout', () => {
    const root = tempDir()
    const path = join(root, '.claude-plugin', 'marketplace.json')
    expect(marketplaceRootDir(path)).toBe(root)
  })

  it('returns null for an unrecognized marketplace location', () => {
    expect(marketplaceRootDir(join(tempDir(), 'random', 'marketplace.json'))).toBeNull()
  })

  it('loads a marketplace with a string-form local source', () => {
    const root = tempDir()
    const path = writeMarketplace(
      root,
      {
        name: 'personal',
        interface: { displayName: 'My Plugins' },
        plugins: [{ name: 'linear', source: './plugins/linear', category: 'Productivity' }]
      },
      [{ name: 'linear', version: '1.2.0' }]
    )

    const market = loadMarketplace(path, silentLogger) as Marketplace
    expect(market).not.toBeNull()
    expect(market.name).toBe('personal')
    expect(market.displayName).toBe('My Plugins')
    expect(market.plugins).toHaveLength(1)
    const plugin = market.plugins[0]
    expect(plugin.name).toBe('linear')
    expect(plugin.localVersion).toBe('1.2.0')
    expect(plugin.category).toBe('Productivity')
    expect(plugin.source).toEqual({ kind: 'local', path: join(root, 'plugins', 'linear') })
    expect(plugin.installation).toBe('AVAILABLE')
    expect(plugin.authentication).toBe('ON_INSTALL')
  })

  it('loads a marketplace with an object-form local source', () => {
    const root = tempDir()
    const path = writeMarketplace(
      root,
      {
        name: 'personal',
        plugins: [
          {
            name: 'demo',
            source: { source: 'local', path: './plugins/demo' },
            policy: { installation: 'INSTALLED_BY_DEFAULT', authentication: 'ON_USE' }
          }
        ]
      },
      [{ name: 'demo' }]
    )

    const market = loadMarketplace(path, silentLogger) as Marketplace
    const plugin = market.plugins[0]
    expect(plugin.source).toEqual({ kind: 'local', path: join(root, 'plugins', 'demo') })
    expect(plugin.installation).toBe('INSTALLED_BY_DEFAULT')
    expect(plugin.authentication).toBe('ON_USE')
  })

  it('skips entries with unsupported (git/url) sources but keeps local ones', () => {
    const root = tempDir()
    const path = writeMarketplace(
      root,
      {
        name: 'personal',
        plugins: [
          { name: 'remote', source: { source: 'url', url: 'https://example.com/x.git' } },
          { name: 'linear', source: './plugins/linear' }
        ]
      },
      [{ name: 'linear', version: '1.0.0' }]
    )

    const market = loadMarketplace(path, silentLogger) as Marketplace
    expect(market.plugins.map((p) => p.name)).toEqual(['linear'])
  })

  it('skips a local source path that escapes the marketplace root', () => {
    const root = tempDir()
    const path = writeMarketplace(root, {
      name: 'personal',
      plugins: [{ name: 'evil', source: './../../etc' }]
    })
    const market = loadMarketplace(path, silentLogger) as Marketplace
    expect(market.plugins).toHaveLength(0)
  })

  it('skips a local source path that does not start with ./', () => {
    const root = tempDir()
    const path = writeMarketplace(root, {
      name: 'personal',
      plugins: [{ name: 'evil', source: 'plugins/evil' }]
    })
    const market = loadMarketplace(path, silentLogger) as Marketplace
    expect(market.plugins).toHaveLength(0)
  })

  it('returns null when the marketplace file is missing or unparseable', () => {
    expect(loadMarketplace(join(tempDir(), 'nope.json'), silentLogger)).toBeNull()
    const root = tempDir()
    const dir = join(root, '.agents', 'plugins')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'marketplace.json')
    writeFileSync(path, '{ not json')
    expect(loadMarketplace(path, silentLogger)).toBeNull()
  })

  it('rejects entries whose plugin name is not a valid segment', () => {
    const root = tempDir()
    const path = writeMarketplace(root, {
      name: 'personal',
      plugins: [{ name: 'bad name!', source: './plugins/bad' }]
    })
    const market = loadMarketplace(path, silentLogger) as Marketplace
    expect(market.plugins).toHaveLength(0)
  })
})
