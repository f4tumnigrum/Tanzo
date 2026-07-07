import type {
  ColorThemeDefinition,
  ColorThemeId,
  PreferencesPatch,
  UserPreferences
} from '@shared/preferences'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

type PreferencesApi = NonNullable<Window['electron']>['preferences']

function requirePreferencesApi(): PreferencesApi {
  const preferencesApi = window.electron?.preferences
  if (!preferencesApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_PREFERENCES_API_UNAVAILABLE',
      'Electron preferences API is not available'
    )
  }
  return withDecodedIpcErrors(preferencesApi)
}

export function isPreferencesApiAvailable(): boolean {
  return Boolean(window.electron?.preferences)
}

export const preferencesClient = {
  get(): Promise<UserPreferences> {
    return requirePreferencesApi().get()
  },
  patch(patch: PreferencesPatch): Promise<UserPreferences> {
    return requirePreferencesApi().patch(patch)
  },
  addCustomTheme(theme: ColorThemeDefinition): Promise<UserPreferences> {
    return requirePreferencesApi().addCustomTheme(theme)
  },
  removeCustomTheme(id: ColorThemeId): Promise<UserPreferences> {
    return requirePreferencesApi().removeCustomTheme(id)
  },
  addWallpaper(): Promise<UserPreferences> {
    return requirePreferencesApi().addWallpaper()
  },
  removeWallpaper(id: string): Promise<UserPreferences> {
    return requirePreferencesApi().removeWallpaper(id)
  },
  clearWallpaper(): Promise<UserPreferences> {
    return requirePreferencesApi().clearWallpaper()
  },
  onChanged(callback: (preferences: UserPreferences) => void): () => void {
    return requirePreferencesApi().onChanged(callback)
  }
}
