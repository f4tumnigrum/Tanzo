export const SYSTEM_CHANNELS = {
  getPlatform: 'system:get-platform',
  getSystemPreferences: 'system:get-preferences',
  preferencesChanged: 'system:preferences-changed',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  pickDirectory: 'system:pick-directory',
  openPath: 'system:open-path',
  revealInFolder: 'system:reveal-in-folder'
} as const

export interface OpenPathResult {
  ok: boolean

  error?: string
}

export type ElectronColorScheme = 'light' | 'dark'

export type ElectronPlatform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export interface ElectronPlatformInfo {
  platform: ElectronPlatform
  arch: string
  version: string
}

export interface ElectronProcessVersions {
  electron?: string
  chrome?: string
  node?: string
  [key: string]: string | undefined
}

export interface ElectronProcessInfo {
  versions: ElectronProcessVersions
}

export interface ElectronSystemPreferences {
  locale: string
  preferredLanguages: string[]
  colorScheme: ElectronColorScheme
}

export interface WindowControlsApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
}

export interface PickDirectoryArgs {
  title?: string

  defaultPath?: string
}

export type NativeWindowEffect = 'vibrancy' | 'acrylic' | null

export function detectNativeWindowEffect(
  platform: NodeJS.Platform,
  osRelease: string
): NativeWindowEffect {
  if (platform === 'darwin') return 'vibrancy'
  if (platform === 'win32') {
    const build = Number(osRelease.split('.')[2])
    return Number.isFinite(build) && build >= 22000 ? 'acrylic' : null
  }
  return null
}
