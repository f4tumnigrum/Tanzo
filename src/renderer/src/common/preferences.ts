import { create } from 'zustand'
import {
  DEFAULT_PREFERENCES,
  type ColorThemeDefinition,
  type ColorThemeId,
  type PreferencesPatch,
  type UserPreferences
} from '@shared/preferences'
import {
  isPreferencesApiAvailable,
  preferencesClient
} from '@/platform/electron/preferences-client'
import { createLogger } from '@/common/logger'

const log = createLogger('renderer.preferences')

interface PreferencesState {
  preferences: UserPreferences
  ready: boolean
  hydrate: (preferences: UserPreferences) => void
}

const store = create<PreferencesState>((set) => ({
  preferences: DEFAULT_PREFERENCES,
  ready: false,
  hydrate: (preferences) => set({ preferences, ready: true })
}))

let unsubscribe: (() => void) | null = null
let bootstrap: Promise<UserPreferences> | null = null

export function bootstrapPreferences(): Promise<UserPreferences> {
  if (bootstrap) return bootstrap
  if (!isPreferencesApiAvailable()) {
    const promise = Promise.resolve(DEFAULT_PREFERENCES)
    bootstrap = promise
    store.getState().hydrate(DEFAULT_PREFERENCES)
    return promise
  }
  const promise = preferencesClient
    .get()
    .catch((error) => {
      log.warn('failed to load preferences; using defaults', error)
      return DEFAULT_PREFERENCES
    })
    .then((value) => {
      store.getState().hydrate(value)
      unsubscribe?.()
      unsubscribe = preferencesClient.onChanged((next) => store.getState().hydrate(next))
      return value
    })
  bootstrap = promise
  return promise
}

export function teardownPreferences(): void {
  unsubscribe?.()
  unsubscribe = null
  bootstrap = null
}

export function usePreferences(): UserPreferences {
  return store((s) => s.preferences)
}

export function usePreferencesReady(): boolean {
  return store((s) => s.ready)
}

export function getPreferencesSnapshot(): UserPreferences {
  return store.getState().preferences
}

async function applyResult(promise: Promise<UserPreferences> | undefined): Promise<void> {
  if (!promise) return
  const next = await promise
  store.getState().hydrate(next)
}

export function patchPreferences(patch: PreferencesPatch): Promise<void> {
  if (!isPreferencesApiAvailable()) return Promise.resolve()
  return applyResult(preferencesClient.patch(patch))
}

export function addCustomTheme(theme: ColorThemeDefinition): Promise<void> {
  if (!isPreferencesApiAvailable()) return Promise.resolve()
  return applyResult(preferencesClient.addCustomTheme(theme))
}

export function removeCustomTheme(id: ColorThemeId): Promise<void> {
  if (!isPreferencesApiAvailable()) return Promise.resolve()
  return applyResult(preferencesClient.removeCustomTheme(id))
}

export function addWallpaper(): Promise<void> {
  if (!isPreferencesApiAvailable()) return Promise.resolve()
  return applyResult(preferencesClient.addWallpaper())
}

export function removeWallpaper(id: string): Promise<void> {
  if (!isPreferencesApiAvailable()) return Promise.resolve()
  return applyResult(preferencesClient.removeWallpaper(id))
}

export function clearWallpaper(): Promise<void> {
  if (!isPreferencesApiAvailable()) return Promise.resolve()
  return applyResult(preferencesClient.clearWallpaper())
}
