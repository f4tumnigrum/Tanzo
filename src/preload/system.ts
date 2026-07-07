import {
  SYSTEM_CHANNELS,
  type ElectronPlatformInfo,
  type ElectronSystemPreferences,
  type NativeWindowEffect,
  type OpenPathResult,
  type PickDirectoryArgs,
  type WindowControlsApi
} from '@shared/system'
import { invoke, subscribe } from './invoke'

const EFFECT_FLAG = '--window-effect='

function readWindowEffect(): NativeWindowEffect {
  const arg = process.argv.find((entry) => entry.startsWith(EFFECT_FLAG))
  if (!arg) return null
  const value = arg.slice(EFFECT_FLAG.length)
  return value === 'vibrancy' || value === 'acrylic' ? value : null
}

export const platformInfo = {
  platform: process.platform as NodeJS.Platform,
  effect: readWindowEffect()
} as const

export const systemApi = {
  platformInfo,
  getPlatform: invoke<() => Promise<ElectronPlatformInfo>>(SYSTEM_CHANNELS.getPlatform),
  getSystemPreferences: invoke<() => Promise<ElectronSystemPreferences>>(
    SYSTEM_CHANNELS.getSystemPreferences
  ),
  pickDirectory: invoke<(args?: PickDirectoryArgs) => Promise<string | null>>(
    SYSTEM_CHANNELS.pickDirectory
  ),
  openPath: invoke<(path: string) => Promise<OpenPathResult>>(SYSTEM_CHANNELS.openPath),
  revealInFolder: invoke<(path: string) => Promise<OpenPathResult>>(SYSTEM_CHANNELS.revealInFolder),
  onSystemPreferencesChanged: (callback: (preferences: ElectronSystemPreferences) => void) =>
    subscribe<ElectronSystemPreferences>(SYSTEM_CHANNELS.preferencesChanged, callback),
  windowControls: {
    minimize: invoke<() => Promise<void>>(SYSTEM_CHANNELS.minimize),
    toggleMaximize: invoke<() => Promise<boolean>>(SYSTEM_CHANNELS.toggleMaximize),
    close: invoke<() => Promise<void>>(SYSTEM_CHANNELS.close),
    isMaximized: invoke<() => Promise<boolean>>(SYSTEM_CHANNELS.isMaximized)
  } satisfies WindowControlsApi
}

export type SystemApi = typeof systemApi
