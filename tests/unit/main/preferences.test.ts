import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_CHANNELS,
  type UserPreferences
} from '@shared/preferences'

const electronMock = vi.hoisted(() => {
  const nativeTheme = {
    themeSource: 'system',
    on: vi.fn()
  }
  const windows: Array<{
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { isDestroyed: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
  }> = []
  return {
    app: { getPath: vi.fn() },
    nativeTheme,
    BrowserWindow: { getAllWindows: vi.fn(() => windows) },
    ipcMain: { handle: vi.fn() },
    windows
  }
})

vi.mock('electron', () => electronMock)

type IpcHandler = (...args: unknown[]) => unknown

let userDataPath = ''

beforeEach(async () => {
  vi.resetModules()
  userDataPath = await mkdtemp(join(tmpdir(), 'tanzo-preferences-'))
  electronMock.app.getPath.mockReturnValue(userDataPath)
  electronMock.nativeTheme.themeSource = 'system'
  electronMock.nativeTheme.on.mockClear()
  electronMock.BrowserWindow.getAllWindows.mockClear()
  electronMock.windows.length = 0
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
})

function ipcTarget() {
  const handlers = new Map<string, IpcHandler>()
  return {
    handlers,
    target: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      })
    }
  }
}

describe('main/preferences', () => {
  it('loads defaults for missing or invalid preference files', async () => {
    await writeFile(join(userDataPath, 'preferences.json'), '{"themeMode":"neon"}')
    const { getPreferences, initPreferences } = await import('@main/preferences')

    initPreferences()

    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(electronMock.nativeTheme.themeSource).toBe('system')
    expect(electronMock.nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function))
  })

  it('migrates a legacy browserOpen disable into browserAutomation=false', async () => {
    await writeFile(
      join(userDataPath, 'preferences.json'),
      JSON.stringify({ disabledTools: ['browserOpen', 'shell'] })
    )
    const { getPreferences, initPreferences } = await import('@main/preferences')

    initPreferences()

    expect(getPreferences().browserAutomation).toBe(false)
    // browserOpen also stays individually disabled, preserving the per-tool
    // intent if the capability master switch is turned back on later.
    expect(getPreferences().disabledTools).toEqual(['browserOpen', 'shell'])
  })

  it('prefers an explicit browserAutomation value over the legacy migration', async () => {
    await writeFile(
      join(userDataPath, 'preferences.json'),
      JSON.stringify({ browserAutomation: true, disabledTools: ['browserOpen'] })
    )
    const { getPreferences, initPreferences } = await import('@main/preferences')

    initPreferences()

    expect(getPreferences().browserAutomation).toBe(true)
  })

  it('migrates a legacy fontSizePresetId into typography.fontSize', async () => {
    await writeFile(
      join(userDataPath, 'preferences.json'),
      JSON.stringify({ fontSizePresetId: 'large' })
    )
    const { getPreferences, initPreferences } = await import('@main/preferences')

    initPreferences()

    expect(getPreferences().typography).toEqual({
      fontSize: 18,
      codeFontSize: 11,
      lineHeight: 1.72,
      sansFont: null,
      monoFont: null
    })
  })

  it('clamps typography values and rejects unsafe font stacks', async () => {
    await writeFile(
      join(userDataPath, 'preferences.json'),
      JSON.stringify({
        typography: {
          fontSize: 99,
          codeFontSize: 1,
          lineHeight: 10,
          sansFont: "'Fira Sans', sans-serif",
          monoFont: 'monospace; background: url(evil)'
        }
      })
    )
    const { getPreferences, initPreferences } = await import('@main/preferences')

    initPreferences()

    expect(getPreferences().typography).toEqual({
      fontSize: 20,
      codeFontSize: 9,
      lineHeight: 2,
      sansFont: "'Fira Sans', sans-serif",
      monoFont: null
    })
  })

  it('merges partial typography patches through IPC', async () => {
    const { handlers, target } = ipcTarget()
    const { registerPreferencesIpc } = await import('@main/preferences')

    registerPreferencesIpc(target as never)
    const patched = (await handlers.get(PREFERENCES_CHANNELS.patch)?.(null, {
      typography: { fontSize: 14 }
    })) as UserPreferences

    expect(patched.typography).toEqual({
      fontSize: 14,
      codeFontSize: 11,
      lineHeight: 1.72,
      sansFont: null,
      monoFont: null
    })
  })

  it('keeps MCP tool ids in disabledTools and drops locked or unknown ids', async () => {
    await writeFile(
      join(userDataPath, 'preferences.json'),
      JSON.stringify({
        disabledTools: [
          'shell',
          'mcp__context7__search_docs',
          // Locked tools cannot be disabled.
          'note',
          'exitPlanMode',
          // Unknown builtin ids are dropped.
          'nonexistentTool'
        ]
      })
    )
    const { getPreferences, initPreferences } = await import('@main/preferences')

    initPreferences()

    expect(getPreferences().disabledTools).toEqual(['shell', 'mcp__context7__search_docs'])
  })

  it('registers IPC handlers that patch preferences, persist them, and broadcast changes', async () => {
    const send = vi.fn()
    electronMock.windows.push({
      isDestroyed: vi.fn(() => false),
      webContents: { isDestroyed: vi.fn(() => false), send }
    })
    const { handlers, target } = ipcTarget()
    const { registerPreferencesIpc } = await import('@main/preferences')

    registerPreferencesIpc(target as never)
    const patched = await handlers.get(PREFERENCES_CHANNELS.patch)?.(null, {
      themeMode: 'dark',
      language: 'zh-CN',
      reasoningExpandedByDefault: false,
      radiusPresetId: 'invalid'
    })

    expect(patched).toMatchObject({
      themeMode: 'dark',
      language: 'zh-CN',
      reasoningExpandedByDefault: false,
      radiusPresetId: DEFAULT_PREFERENCES.radiusPresetId
    })
    expect(electronMock.nativeTheme.themeSource).toBe('dark')
    expect(send).toHaveBeenCalledWith(PREFERENCES_CHANNELS.changed, patched)
    await expect(readFile(join(userDataPath, 'preferences.json'), 'utf8')).resolves.toContain(
      '"themeMode": "dark"'
    )
  })

  it('does not update cache or broadcast when persistence fails', async () => {
    const send = vi.fn()
    electronMock.windows.push({
      isDestroyed: vi.fn(() => false),
      webContents: { isDestroyed: vi.fn(() => false), send }
    })
    await mkdir(join(userDataPath, 'preferences.json'))
    const { handlers, target } = ipcTarget()
    const { getPreferences, registerPreferencesIpc } = await import('@main/preferences')
    registerPreferencesIpc(target as never)

    expect(() => handlers.get(PREFERENCES_CHANNELS.patch)?.(null, { themeMode: 'dark' })).toThrow()

    expect(getPreferences().themeMode).toBe(DEFAULT_PREFERENCES.themeMode)
    expect(electronMock.nativeTheme.themeSource).toBe('system')
    expect(send).not.toHaveBeenCalled()
  })

  it('adds and removes valid custom themes through IPC', async () => {
    const { handlers, target } = ipcTarget()
    const { registerPreferencesIpc } = await import('@main/preferences')
    registerPreferencesIpc(target as never)
    const colors = Object.fromEntries(
      [
        'background',
        'foreground',
        'card',
        'card-foreground',
        'popover',
        'popover-foreground',
        'primary',
        'primary-foreground',
        'secondary',
        'secondary-foreground',
        'muted',
        'muted-foreground',
        'accent',
        'accent-foreground',
        'destructive',
        'destructive-foreground',
        'border',
        'input',
        'ring',
        'sidebar',
        'sidebar-foreground',
        'sidebar-primary',
        'sidebar-primary-foreground',
        'sidebar-accent',
        'sidebar-accent-foreground',
        'sidebar-border',
        'sidebar-ring',
        'sidebar-ring',
        'chart-1',
        'chart-2',
        'chart-3',
        'chart-4',
        'chart-5'
      ].map((key) => [key, '#000000'])
    )

    const withTheme = (await handlers.get(PREFERENCES_CHANNELS.addCustomTheme)?.(null, {
      id: 'custom',
      name: 'Custom',
      description: '',
      light: colors,
      dark: colors
    })) as UserPreferences
    expect(withTheme.customThemes).toEqual([
      expect.objectContaining({ id: 'custom', description: 'Custom' })
    ])

    const removed = (await handlers.get(PREFERENCES_CHANNELS.removeCustomTheme)?.(
      null,
      'custom'
    )) as UserPreferences
    expect(removed.customThemes).toEqual([])
  })

  it('migrates a legacy assetPath wallpaper to the asset library', async () => {
    await writeFile(
      join(userDataPath, 'preferences.json'),
      JSON.stringify({ wallpaper: { assetPath: '/home/user/bg.jpg', opacity: 0.5 } })
    )
    const { getPreferences, initPreferences } = await import('@main/preferences')
    initPreferences()

    const { wallpaper } = getPreferences()
    expect(wallpaper.assets).toHaveLength(1)
    expect(wallpaper.assets[0]?.path).toBe('/home/user/bg.jpg')
    expect(wallpaper.activeId).toBe('legacy')
    expect(wallpaper.opacity).toBe(0.5)
  })

  it('addWallpaperAsset appends the asset and sets it as active', async () => {
    const { addWallpaperAsset, getPreferences, initPreferences } = await import('@main/preferences')
    initPreferences()

    const asset = {
      id: 'test-1',
      path: 'tanzo-asset://wallpaper/bg.jpg',
      addedAt: new Date().toISOString()
    }
    addWallpaperAsset(asset)

    const { wallpaper } = getPreferences()
    expect(wallpaper.assets).toHaveLength(1)
    expect(wallpaper.activeId).toBe('test-1')
  })

  it('removeWallpaperAsset deactivates the asset and promotes the next one', async () => {
    const { addWallpaperAsset, removeWallpaperAsset, getPreferences, initPreferences } =
      await import('@main/preferences')
    initPreferences()

    const now = new Date().toISOString()
    addWallpaperAsset({ id: 'a', path: 'tanzo-asset://wallpaper/a.jpg', addedAt: now })
    addWallpaperAsset({ id: 'b', path: 'tanzo-asset://wallpaper/b.jpg', addedAt: now })
    removeWallpaperAsset('b')

    const { wallpaper } = getPreferences()
    expect(wallpaper.assets).toHaveLength(1)
    expect(wallpaper.activeId).toBe('a')
  })

  it('clearAllWallpapers resets assets and active ids', async () => {
    const { addWallpaperAsset, clearAllWallpapers, getPreferences, initPreferences } =
      await import('@main/preferences')
    initPreferences()

    const now = new Date().toISOString()
    addWallpaperAsset({ id: 'x', path: 'tanzo-asset://wallpaper/x.jpg', addedAt: now })
    clearAllWallpapers()

    const { wallpaper } = getPreferences()
    expect(wallpaper.assets).toHaveLength(0)
    expect(wallpaper.activeId).toBeNull()
    expect(wallpaper.darkAssetId).toBeNull()
  })
})
