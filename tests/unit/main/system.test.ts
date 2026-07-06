import { describe, expect, it, vi } from 'vitest'
import { SYSTEM_CHANNELS } from '@shared/system'

const electronMock = vi.hoisted(() => {
  const dialog = { showOpenDialog: vi.fn() }
  const windows: Array<{
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { isDestroyed: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
  }> = []
  return {
    app: {
      getLocale: vi.fn(() => 'en-US'),
      getPreferredSystemLanguages: vi.fn(() => ['en-US', 'zh-CN']),
      getVersion: vi.fn(() => '1.2.3'),
      quit: vi.fn()
    },
    nativeTheme: { shouldUseDarkColors: false },
    BrowserWindow: { getAllWindows: vi.fn(() => windows) },
    dialog,
    ipcMain: { handle: vi.fn() },
    windows
  }
})

vi.mock('electron', () => electronMock)

type IpcHandler = (...args: unknown[]) => unknown

function ipcTarget() {
  const handlers = new Map<string, IpcHandler>()
  return {
    handlers,
    target: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
}

describe('main/system', () => {
  it('reads and broadcasts system preferences', async () => {
    const send = vi.fn()
    electronMock.windows.push({
      isDestroyed: vi.fn(() => false),
      webContents: { isDestroyed: vi.fn(() => false), send }
    })
    const { broadcastSystemPreferences, getSystemPreferences } = await import('@main/system')

    expect(getSystemPreferences()).toEqual({
      locale: 'en-US',
      preferredLanguages: ['en-US', 'zh-CN'],
      colorScheme: 'light'
    })
    broadcastSystemPreferences()
    expect(send).toHaveBeenCalledWith(SYSTEM_CHANNELS.preferencesChanged, {
      locale: 'en-US',
      preferredLanguages: ['en-US', 'zh-CN'],
      colorScheme: 'light'
    })
  })

  it('registers platform, directory, and window control IPC handlers', async () => {
    const mainWindow = {
      minimize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn()
    }
    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/workspace']
    })
    const { handlers, target } = ipcTarget()
    const { registerSystemIpc } = await import('@main/system')

    registerSystemIpc(() => mainWindow as never, target as never)

    expect(handlers.get(SYSTEM_CHANNELS.getPlatform)?.()).toMatchObject({
      platform: process.platform,
      arch: process.arch,
      version: '1.2.3'
    })
    await expect(
      handlers.get(SYSTEM_CHANNELS.pickDirectory)?.(null, { title: 'Pick', defaultPath: '/tmp' })
    ).resolves.toBe('/tmp/workspace')
    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(
      mainWindow,
      expect.objectContaining({ title: 'Pick', defaultPath: '/tmp' })
    )
    expect(handlers.get(SYSTEM_CHANNELS.toggleMaximize)?.()).toBe(true)
    expect(mainWindow.maximize).toHaveBeenCalled()
    handlers.get(SYSTEM_CHANNELS.minimize)?.()
    handlers.get(SYSTEM_CHANNELS.close)?.()
    expect(mainWindow.minimize).toHaveBeenCalled()
    expect(electronMock.app.quit).toHaveBeenCalled()
  })
})
