import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type IpcMain } from 'electron'
import {
  SYSTEM_CHANNELS,
  type ElectronPlatformInfo,
  type ElectronSystemPreferences,
  type PickDirectoryArgs
} from '@shared/system'

const HANDLED_CHANNELS = [
  SYSTEM_CHANNELS.getPlatform,
  SYSTEM_CHANNELS.getSystemPreferences,
  SYSTEM_CHANNELS.pickDirectory,
  SYSTEM_CHANNELS.minimize,
  SYSTEM_CHANNELS.close,
  SYSTEM_CHANNELS.isMaximized,
  SYSTEM_CHANNELS.toggleMaximize
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePickDirectoryArgs(value: unknown): PickDirectoryArgs {
  if (!isRecord(value)) return {}
  return {
    ...(typeof value.title === 'string' && value.title.trim().length > 0
      ? { title: value.title }
      : {}),
    ...(typeof value.defaultPath === 'string' && value.defaultPath.trim().length > 0
      ? { defaultPath: value.defaultPath }
      : {})
  }
}

export function getSystemPreferences(): ElectronSystemPreferences {
  return {
    locale: app.getLocale(),
    preferredLanguages: app.getPreferredSystemLanguages(),
    colorScheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

export function broadcastSystemPreferences(): void {
  const preferences = getSystemPreferences()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send(SYSTEM_CHANNELS.preferencesChanged, preferences)
  }
}

export function registerSystemIpc(
  mainWindowRef: () => BrowserWindow | null,
  target: IpcMain = ipcMain
): void {
  for (const channel of HANDLED_CHANNELS) target.removeHandler(channel)

  target.handle(SYSTEM_CHANNELS.getPlatform, (): ElectronPlatformInfo => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion()
  }))

  target.handle(SYSTEM_CHANNELS.getSystemPreferences, () => getSystemPreferences())

  target.handle(SYSTEM_CHANNELS.pickDirectory, async (_event, rawArgs?: unknown) => {
    const args = normalizePickDirectoryArgs(rawArgs)
    const window = mainWindowRef()
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
      ...(args?.title && { title: args.title }),
      ...(args?.defaultPath && { defaultPath: args.defaultPath })
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  target.handle(SYSTEM_CHANNELS.minimize, () => mainWindowRef()?.minimize())
  target.handle(SYSTEM_CHANNELS.close, () => app.quit())
  target.handle(SYSTEM_CHANNELS.isMaximized, () => mainWindowRef()?.isMaximized() ?? false)
  target.handle(SYSTEM_CHANNELS.toggleMaximize, () => {
    const window = mainWindowRef()
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
}
