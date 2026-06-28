import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '@main/agent/logging'
import {
  findManifestPath,
  loadPluginManifest,
  resolveManifestPath
} from '@main/agent/plugins/manifest'

const dirs: string[] = []

function tempPlugin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tanzo-plugin-'))
  dirs.push(dir)
  return dir
}

function fakeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger
}

function writeManifest(
  pluginRoot: string,
  manifest: unknown,
  relative = '.codex-plugin/plugin.json'
): void {
  const path = join(pluginRoot, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(manifest), 'utf8')
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('main/agent/plugins/manifest', () => {
  describe('findManifestPath', () => {
    it('finds .codex-plugin/plugin.json', () => {
      const root = tempPlugin()
      writeManifest(root, { name: 'demo' })
      expect(findManifestPath(root)).toBe(join(root, '.codex-plugin/plugin.json'))
    })

    it('falls back to .claude-plugin/plugin.json', () => {
      const root = tempPlugin()
      writeManifest(root, { name: 'demo' }, '.claude-plugin/plugin.json')
      expect(findManifestPath(root)).toBe(join(root, '.claude-plugin/plugin.json'))
    })

    it('prefers .codex-plugin over .claude-plugin', () => {
      const root = tempPlugin()
      writeManifest(root, { name: 'codex' }, '.codex-plugin/plugin.json')
      writeManifest(root, { name: 'claude' }, '.claude-plugin/plugin.json')
      expect(findManifestPath(root)).toBe(join(root, '.codex-plugin/plugin.json'))
    })

    it('returns null when no manifest exists', () => {
      expect(findManifestPath(tempPlugin())).toBeNull()
    })
  })

  describe('loadPluginManifest', () => {
    it('parses a full manifest with contribution paths and interface', () => {
      const root = tempPlugin()
      writeManifest(root, {
        name: 'linear',
        version: ' 1.2.0 ',
        description: 'Linear integration',
        keywords: ['issues', 'tickets'],
        skills: './skills',
        mcpServers: './.mcp.json',
        apps: './.app.json',
        hooks: './hooks.json',
        interface: {
          displayName: 'Linear',
          category: 'Productivity',
          capabilities: ['Write'],
          websiteURL: 'https://linear.app',
          defaultPrompt: ['  Summarize   my   issues  ']
        }
      })

      const manifest = loadPluginManifest(root, fakeLogger())
      expect(manifest).not.toBeNull()
      expect(manifest?.name).toBe('linear')
      expect(manifest?.version).toBe('1.2.0')
      expect(manifest?.description).toBe('Linear integration')
      expect(manifest?.keywords).toEqual(['issues', 'tickets'])
      expect(manifest?.paths.skills).toBe(join(root, 'skills'))
      expect(manifest?.paths.mcpServers).toBe(join(root, '.mcp.json'))
      expect(manifest?.paths.apps).toBe(join(root, '.app.json'))
      expect(manifest?.paths.hooks).toBe(join(root, 'hooks.json'))
      expect(manifest?.interface?.displayName).toBe('Linear')
      expect(manifest?.interface?.websiteUrl).toBe('https://linear.app')
      expect(manifest?.interface?.defaultPrompt).toEqual(['Summarize my issues'])
    })

    it('falls back to the directory name when name is blank', () => {
      const root = tempPlugin()
      writeManifest(root, { name: '   ' })
      const manifest = loadPluginManifest(root, fakeLogger())
      // Directory basename is the mkdtemp folder name.
      expect(manifest?.name).toBe(root.split(/[/\\]/).filter(Boolean).pop())
    })

    it('drops contribution paths that escape the plugin root', () => {
      const root = tempPlugin()
      const logger = fakeLogger()
      writeManifest(root, {
        name: 'demo',
        skills: '../evil',
        mcpServers: '/etc/passwd',
        apps: 'no-dot-slash',
        hooks: './hooks.json'
      })
      const manifest = loadPluginManifest(root, logger)
      expect(manifest?.paths.skills).toBeNull()
      expect(manifest?.paths.mcpServers).toBeNull()
      expect(manifest?.paths.apps).toBeNull()
      expect(manifest?.paths.hooks).toBe(join(root, 'hooks.json'))
      expect(logger.warn).toHaveBeenCalled()
    })

    it('omits the interface when it has no meaningful content', () => {
      const root = tempPlugin()
      writeManifest(root, { name: 'demo', interface: {} })
      const manifest = loadPluginManifest(root, fakeLogger())
      expect(manifest?.interface).toBeUndefined()
    })

    it('returns null for unparseable JSON', () => {
      const root = tempPlugin()
      const path = join(root, '.codex-plugin/plugin.json')
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, '{ not json', 'utf8')
      expect(loadPluginManifest(root, fakeLogger())).toBeNull()
    })

    it('returns null when no manifest file exists', () => {
      expect(loadPluginManifest(tempPlugin(), fakeLogger())).toBeNull()
    })
  })

  describe('resolveManifestPath', () => {
    const root = '/plugins/demo'

    it('resolves a valid ./ relative path', () => {
      expect(resolveManifestPath(root, 'skills', './skills', fakeLogger())).toBe(
        join(root, 'skills')
      )
    })

    it('rejects paths without a ./ prefix', () => {
      expect(resolveManifestPath(root, 'skills', 'skills', fakeLogger())).toBeNull()
    })

    it('rejects paths containing ..', () => {
      expect(resolveManifestPath(root, 'skills', './../escape', fakeLogger())).toBeNull()
    })

    it('rejects a bare ./', () => {
      expect(resolveManifestPath(root, 'skills', './', fakeLogger())).toBeNull()
    })

    it('returns null for non-string and nullish values', () => {
      expect(resolveManifestPath(root, 'skills', 123, fakeLogger())).toBeNull()
      expect(resolveManifestPath(root, 'skills', null, fakeLogger())).toBeNull()
      expect(resolveManifestPath(root, 'skills', undefined, fakeLogger())).toBeNull()
    })
  })
})
