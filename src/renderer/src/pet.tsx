import './assets/main.css'
import './features/pet/pet.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { UserPreferences } from '@shared/preferences'
import type { ElectronColorScheme } from '@shared/system'
import { preferencesClient } from './platform/electron/preferences-client'
import { systemClient } from './platform/electron/system-client'
import { bootstrapPreferences } from './common/preferences'
import { applyThemeSettings, getColorThemeById, resolveThemeMode } from './common/theme'
import { initializeI18n } from './i18n'
import { PetApp } from './features/pet/pet-app'

const root = document.documentElement
const platform = systemClient.platformInfo()?.platform ?? 'unknown'
root.classList.add('electron', `platform-${platform}`)

let currentPreferences: UserPreferences | null = null
let currentColorScheme: ElectronColorScheme = 'light'

function applyTheme(): void {
  if (!currentPreferences) return
  const prefs = currentPreferences
  applyThemeSettings({
    colorThemeId: getColorThemeById(prefs.colorThemeId).id,
    radiusPresetId: prefs.radiusPresetId,
    densityPresetId: prefs.densityPresetId,
    typography: prefs.typography,
    mode: resolveThemeMode(prefs.themeMode, currentColorScheme)
  })
}

async function bootstrapPet(): Promise<void> {
  try {
    const [systemPreferences, preferences] = await Promise.all([
      systemClient.getSystemPreferences(),
      bootstrapPreferences()
    ])
    currentColorScheme = systemPreferences.colorScheme
    currentPreferences = preferences
    applyTheme()

    systemClient.onSystemPreferencesChanged((next) => {
      currentColorScheme = next.colorScheme
      applyTheme()
    })
    preferencesClient.onChanged((next) => {
      currentPreferences = next
      applyTheme()
    })

    await initializeI18n(systemPreferences)
  } catch {
    await initializeI18n()
  }

  createRoot(document.getElementById('pet-root')!).render(
    <StrictMode>
      <PetApp />
    </StrictMode>
  )
}

void bootstrapPet()
