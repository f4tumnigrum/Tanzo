import {
  PREFERENCES_CHANNELS,
  type ColorThemeDefinition,
  type ColorThemeId,
  type PreferencesPatch,
  type UserPreferences
} from '@shared/preferences'
import { invoke, subscribe } from './invoke'

export const preferencesApi = {
  get: invoke<() => Promise<UserPreferences>>(PREFERENCES_CHANNELS.get),
  patch: invoke<(patch: PreferencesPatch) => Promise<UserPreferences>>(PREFERENCES_CHANNELS.patch),
  addCustomTheme: invoke<(theme: ColorThemeDefinition) => Promise<UserPreferences>>(
    PREFERENCES_CHANNELS.addCustomTheme
  ),
  removeCustomTheme: invoke<(id: ColorThemeId) => Promise<UserPreferences>>(
    PREFERENCES_CHANNELS.removeCustomTheme
  ),
  addWallpaper: invoke<() => Promise<UserPreferences>>(PREFERENCES_CHANNELS.addWallpaper),
  removeWallpaper: invoke<(id: string) => Promise<UserPreferences>>(
    PREFERENCES_CHANNELS.removeWallpaper
  ),
  clearWallpaper: invoke<() => Promise<UserPreferences>>(PREFERENCES_CHANNELS.clearWallpaper),
  onChanged: (callback: (preferences: UserPreferences) => void) =>
    subscribe<UserPreferences>(PREFERENCES_CHANNELS.changed, callback)
}

export type PreferencesApi = typeof preferencesApi
