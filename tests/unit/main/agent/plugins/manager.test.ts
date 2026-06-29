import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealDb, type RealDb } from '../../../../helpers/real-db'
import { createPluginStore } from '@main/agent/plugins/store'
import { createPluginStateStore } from '@main/agent/plugins/plugin-state-db'
import { createPluginsManager, type PluginsManager } from '@main/agent/plugins/manager'

const tempDirs: string[] = []
const dbs: RealDb[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const db of dbs.splice(0)) db.close()
})

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tanzo-plugin-mgr-'))
  tempDirs.push(dir)
  return dir
}

/**
 * Lay out a personal marketplace under `<home>/.agents/plugins/marketplace.json`
 * plus a local plugin at `<home>/plugins/<name>` with the given manifest.
 */
function writePersonalMarketplace(
  home: string,
  entries: { name: string; manifest: Record<string, unknown>; mcp?: Record<string, unknown> }[]
): void {
  const dir = join(home, '.agents', 'plugins')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'marketplace.json'),
    JSON.stringify({
      name: 'personal',
      plugins: entries.map((e) => ({
        name: e.name,
        source: `./plugins/${e.name}`,
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Testing'
      }))
    })
  )
  for (const entry of entries) {
    const pluginDir = join(home, 'plugins', entry.name)
    mkdirSync(join(pluginDir, '.codex-plugin'), { recursive: true })
    writeFileSync(join(pluginDir, '.codex-plugin', 'plugin.json'), JSON.stringify(entry.manifest))
    if (entry.mcp) {
      writeFileSync(join(pluginDir, '.mcp.json'), JSON.stringify(entry.mcp))
    }
  }
}

function makeManager(home: string): PluginsManager {
  const cacheRoot = tempDir()
  const db = createRealDb()
  dbs.push(db)
  return createPluginsManager({
    store: createPluginStore(cacheRoot, silentLogger),
    state: createPluginStateStore(db),
    marketplaceRoots: [home],
    installer: null,
    logger: silentLogger
  })
}

describe('main/agent/plugins/manager', () => {
  it('lists marketplace plugins with installed=false before install', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [
      { name: 'linear', manifest: { name: 'linear', version: '1.0.0', description: 'Linear' } }
    ])
    const manager = makeManager(home)

    const entries = manager.listMarketplacePlugins()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('linear@personal')
    expect(entries[0].installed).toBe(false)
    expect(entries[0].category).toBe('Testing')
    // Display metadata comes from the plugin's own manifest.
    expect(entries[0].description).toBe('Linear')
  })

  it('installs a plugin into the cache and lists it as enabled', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [
      {
        name: 'demo',
        manifest: { name: 'demo', version: '2.1.0', description: 'Demo plugin' },
        mcp: { mcpServers: { demo: { type: 'stdio', command: 'demo-bin' } } }
      }
    ])
    const manager = makeManager(home)

    const snapshot = manager.install({ id: 'demo@personal' })
    expect(snapshot.plugins).toHaveLength(1)
    const summary = snapshot.plugins[0]
    expect(summary.id).toBe('demo@personal')
    expect(summary.version).toBe('2.1.0')
    expect(summary.enabled).toBe(true)
    expect(summary.displayName).toBe('demo')
    expect(summary.contributes.mcpServers).toBe(1)

    // It is now discoverable as installed.
    expect(manager.listMarketplacePlugins()[0].installed).toBe(true)
  })

  it('toggles enable state and reflects it in the load outcome', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [
      {
        name: 'demo',
        manifest: { name: 'demo', version: '1.0.0' },
        mcp: { mcpServers: { srv: { type: 'stdio', command: 'x' } } }
      }
    ])
    const manager = makeManager(home)
    manager.install({ id: 'demo@personal' })

    expect(manager.loadOutcome().effectiveMcpServers()).toHaveLength(1)

    manager.setEnabled('demo@personal', false)
    expect(manager.list().plugins[0].enabled).toBe(false)
    // Disabled plugins contribute nothing.
    expect(manager.loadOutcome().effectiveMcpServers()).toHaveLength(0)

    manager.setEnabled('demo@personal', true)
    expect(manager.loadOutcome().effectiveMcpServers()).toHaveLength(1)
  })

  it('uninstalls a plugin and drops it from the snapshot', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [{ name: 'demo', manifest: { name: 'demo', version: '1.0.0' } }])
    const manager = makeManager(home)
    manager.install({ id: 'demo@personal' })
    expect(manager.list().plugins).toHaveLength(1)

    const snapshot = manager.uninstall('demo@personal')
    expect(snapshot.plugins).toHaveLength(0)
    expect(manager.listMarketplacePlugins()[0].installed).toBe(false)
  })

  it('rejects installing a plugin id absent from every marketplace', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [])
    const manager = makeManager(home)
    expect(() => manager.install({ id: 'ghost@personal' })).toThrow(/not found in any/i)
  })

  it('rejects enabling a plugin that is not installed', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [{ name: 'demo', manifest: { name: 'demo', version: '1.0.0' } }])
    const manager = makeManager(home)
    expect(() => manager.setEnabled('demo@personal', false)).toThrow(/not installed/i)
  })

  it('exposes detail with keywords and mcp server names', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [
      {
        name: 'demo',
        manifest: {
          name: 'demo',
          version: '1.0.0',
          description: 'A demo',
          keywords: ['a', 'b']
        },
        mcp: { mcpServers: { one: { type: 'stdio', command: 'x' }, two: { url: 'https://h' } } }
      }
    ])
    const manager = makeManager(home)
    manager.install({ id: 'demo@personal' })

    const detail = manager.detail('demo@personal')
    expect(detail).not.toBeNull()
    expect(detail?.keywords).toEqual(['a', 'b'])
    expect(detail?.mcpServerNames.sort()).toEqual(['one', 'two'])
    expect(detail?.category).toBe('Testing')
  })

  it('emits onContributionsChanged for install/enable/uninstall and stops after unsubscribe', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [{ name: 'demo', manifest: { name: 'demo', version: '1.0.0' } }])
    const manager = makeManager(home)

    let count = 0
    const unsubscribe = manager.onContributionsChanged(() => {
      count += 1
    })

    manager.install({ id: 'demo@personal' })
    expect(count).toBe(1)
    manager.setEnabled('demo@personal', false)
    expect(count).toBe(2)
    manager.uninstall('demo@personal')
    expect(count).toBe(3)

    unsubscribe()
    manager.install({ id: 'demo@personal' })
    expect(count).toBe(3)
  })

  it('exposes typed contribution getters adapted to subsystem shapes', () => {
    const home = tempDir()
    writePersonalMarketplace(home, [
      {
        name: 'demo',
        manifest: { name: 'demo', version: '1.0.0', skills: './skills' },
        mcp: { mcpServers: { srv: { type: 'streamable_http', url: 'https://example.com/mcp' } } }
      }
    ])
    // Give the plugin a skills dir and a hooks config so all three contribute.
    const pluginDir = join(home, 'plugins', 'demo')
    mkdirSync(join(pluginDir, 'skills'), { recursive: true })
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true })
    writeFileSync(join(pluginDir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }))
    const manager = makeManager(home)
    manager.install({ id: 'demo@personal' })

    // Skills: namespaced by the plugin's manifest name. The dir resolves under
    // the versioned cache root (`.../demo/<version>/skills`).
    const skillRoots = manager.skillRoots()
    expect(skillRoots).toHaveLength(1)
    expect(skillRoots[0].namespace).toBe('demo')
    expect(skillRoots[0].dir.endsWith(`${sep}skills`)).toBe(true)

    // MCP: Codex `streamable_http` maps to Tanzo `http`, marked enabled, no id.
    const mcp = manager.mcpServers()
    expect(mcp).toHaveLength(1)
    expect(mcp[0]).toMatchObject({
      name: 'srv',
      transport: 'http',
      url: 'https://example.com/mcp',
      enabled: true
    })
    expect(mcp[0].id).toBeUndefined()

    // Hooks: always a `managed` source (auto-trusted).
    const sources = manager.hookSources()
    expect(sources).toHaveLength(1)
    expect(sources[0].source).toBe('managed')
    expect(sources[0].path).toContain(join('hooks', 'hooks.json'))

    // Disabling the plugin empties every contribution getter.
    manager.setEnabled('demo@personal', false)
    expect(manager.skillRoots()).toHaveLength(0)
    expect(manager.mcpServers()).toHaveLength(0)
    expect(manager.hookSources()).toHaveLength(0)
  })
})
