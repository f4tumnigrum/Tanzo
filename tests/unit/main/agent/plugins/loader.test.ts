import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPluginStore } from '@main/agent/plugins/store'
import { loadPlugins, type ConfiguredPlugin } from '@main/agent/plugins/loader'
import type { PluginId } from '@main/agent/plugins/plugin-id'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tanzo-plugin-loader-'))
  tempDirs.push(dir)
  return dir
}

function id(pluginName: string, marketplaceName = 'personal'): PluginId {
  return { pluginName, marketplaceName }
}

/**
 * Write a plugin source tree, then install it into a store rooted at
 * `storeRoot`. Returns nothing; the plugin becomes resolvable via the store.
 */
function installPlugin(
  storeRoot: string,
  pluginId: PluginId,
  options: {
    manifest?: Record<string, unknown>
    skills?: { name: string; body: string }[]
    mcp?: Record<string, unknown>
    hooks?: Record<string, unknown>
  } = {}
): void {
  const source = mkdtempSync(join(tmpdir(), 'tanzo-plugin-src-'))
  tempDirs.push(source)
  mkdirSync(join(source, '.codex-plugin'), { recursive: true })
  writeFileSync(
    join(source, '.codex-plugin', 'plugin.json'),
    JSON.stringify(options.manifest ?? { name: pluginId.pluginName })
  )
  if (options.skills) {
    for (const skill of options.skills) {
      const dir = join(source, 'skills', skill.name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), skill.body)
    }
  }
  if (options.mcp) {
    writeFileSync(join(source, '.mcp.json'), JSON.stringify(options.mcp))
  }
  if (options.hooks) {
    mkdirSync(join(source, 'hooks'), { recursive: true })
    writeFileSync(join(source, 'hooks', 'hooks.json'), JSON.stringify(options.hooks))
  }
  createPluginStore(storeRoot, silentLogger).install(source, pluginId)
}

describe('main/agent/plugins/loader', () => {
  it('assembles default skill / mcp / hook contributions for an installed plugin', () => {
    const root = tempRoot()
    installPlugin(root, id('linear'), {
      skills: [{ name: 'triage', body: '---\nname: triage\ndescription: x\n---\nbody' }],
      mcp: { mcpServers: { linear: { type: 'stdio', command: 'linear-mcp', args: ['--serve'] } } },
      hooks: { hooks: { PreToolUse: [] } }
    })
    const store = createPluginStore(root, silentLogger)
    const outcome = loadPlugins([{ id: id('linear'), enabled: true }], store, silentLogger)

    expect(outcome.plugins).toHaveLength(1)
    const plugin = outcome.plugins[0]
    expect(plugin.error).toBeUndefined()
    expect(plugin.skillRoot).toBe(store.activePluginRoot(id('linear'))! + '/skills')
    expect(plugin.mcpServers).toEqual([
      { name: 'linear', type: 'stdio', command: 'linear-mcp', args: ['--serve'] }
    ])
    expect(plugin.hooksPath).toBe(store.activePluginRoot(id('linear'))! + '/hooks/hooks.json')
  })

  it('namespaces skill roots by manifest name and dedupes first-wins', () => {
    const root = tempRoot()
    installPlugin(root, id('alpha'), {
      manifest: { name: 'alpha' },
      skills: [{ name: 's', body: '---\nname: s\ndescription: d\n---\n' }]
    })
    const store = createPluginStore(root, silentLogger)
    const outcome = loadPlugins([{ id: id('alpha'), enabled: true }], store, silentLogger)

    const roots = outcome.effectiveSkillRoots()
    expect(roots).toHaveLength(1)
    expect(roots[0].namespace).toBe('alpha')
    expect(roots[0].pluginId).toBe('alpha@personal')
  })

  it('excludes disabled plugins from effective contributions', () => {
    const root = tempRoot()
    installPlugin(root, id('linear'), {
      mcp: { mcpServers: { linear: { type: 'stdio', command: 'x' } } }
    })
    const store = createPluginStore(root, silentLogger)
    const outcome = loadPlugins([{ id: id('linear'), enabled: false }], store, silentLogger)

    expect(outcome.plugins[0].enabled).toBe(false)
    expect(outcome.effectiveMcpServers()).toEqual([])
    expect(outcome.effectiveSkillRoots()).toEqual([])
    expect(outcome.effectiveHookPaths()).toEqual([])
  })

  it('marks an uninstalled configured plugin as errored', () => {
    const root = tempRoot()
    const store = createPluginStore(root, silentLogger)
    const outcome = loadPlugins([{ id: id('ghost'), enabled: true }], store, silentLogger)

    expect(outcome.plugins[0].error).toBe('plugin is not installed')
    expect(outcome.effectiveMcpServers()).toEqual([])
  })

  it('resolves first-wins on MCP server name collisions across plugins', () => {
    const root = tempRoot()
    installPlugin(root, id('alpha'), {
      mcp: { mcpServers: { shared: { type: 'stdio', command: 'alpha-cmd' } } }
    })
    installPlugin(root, id('zeta'), {
      mcp: { mcpServers: { shared: { type: 'stdio', command: 'zeta-cmd' } } }
    })
    const store = createPluginStore(root, silentLogger)
    const configured: ConfiguredPlugin[] = [
      { id: id('zeta'), enabled: true },
      { id: id('alpha'), enabled: true }
    ]
    const outcome = loadPlugins(configured, store, silentLogger)

    const servers = outcome.effectiveMcpServers()
    expect(servers).toHaveLength(1)
    // alpha@personal sorts before zeta@personal, so alpha wins the name.
    expect(servers[0].command).toBe('alpha-cmd')
  })

  it('reads a bare server map .mcp.json (no mcpServers wrapper)', () => {
    const root = tempRoot()
    installPlugin(root, id('bare'), {
      mcp: { srv: { type: 'stdio', command: 'bare-cmd', env: { TOKEN: 'x' } } }
    })
    const store = createPluginStore(root, silentLogger)
    const outcome = loadPlugins([{ id: id('bare'), enabled: true }], store, silentLogger)

    expect(outcome.plugins[0].mcpServers).toEqual([
      { name: 'srv', type: 'stdio', command: 'bare-cmd', env: { TOKEN: 'x' } }
    ])
  })

  it('resolves a relative mcp cwd against the plugin root', () => {
    const root = tempRoot()
    installPlugin(root, id('cwd'), {
      mcp: { mcpServers: { srv: { type: 'stdio', command: 'c', cwd: 'sub/dir' } } }
    })
    const store = createPluginStore(root, silentLogger)
    const outcome = loadPlugins([{ id: id('cwd'), enabled: true }], store, silentLogger)

    expect(outcome.plugins[0].mcpServers[0].cwd).toBe(
      store.activePluginRoot(id('cwd'))! + '/sub/dir'
    )
  })
})
