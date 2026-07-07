import * as React from 'react'
import type { ElectronColorScheme } from '@shared/system'
import { TanzoInvariantError } from '@shared/errors'
import { isSystemApiAvailable, systemClient } from '@/platform/electron/system-client'
import { ThemeInitializer, resolveThemeMode } from '@/common/theme'
import { patchPreferences, usePreferences } from '@/common/preferences'
import type { ThemeMode } from '@shared/preferences'

type ThemeContextValue = {
  theme: ThemeMode
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  children,
  initialSystemColorScheme = 'light'
}: {
  children: React.ReactNode
  initialSystemColorScheme?: ElectronColorScheme
}) {
  const themeMode = usePreferences().themeMode
  const [systemTheme, setSystemTheme] =
    React.useState<ElectronColorScheme>(initialSystemColorScheme)

  React.useEffect(() => {
    if (!isSystemApiAvailable()) return
    return systemClient.onSystemPreferencesChanged((preferences) => {
      setSystemTheme(preferences.colorScheme)
    })
  }, [])

  const resolvedTheme = resolveThemeMode(themeMode, systemTheme)

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const setTheme = React.useCallback((next: ThemeMode) => {
    void patchPreferences({ themeMode: next })
  }, [])

  const value = React.useMemo(
    () => ({ theme: themeMode, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, themeMode]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ThemeInitializer />
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new TanzoInvariantError('useTheme must be used within ThemeProvider')
  return ctx
}
