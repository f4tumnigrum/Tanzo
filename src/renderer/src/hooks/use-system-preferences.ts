import { useEffect, useState } from 'react'
import type { ElectronColorScheme, ElectronSystemPreferences } from '@shared/system'
import { isSystemApiAvailable, systemClient } from '@/platform/electron/system-client'
import { createLogger } from '@/common/logger'

const log = createLogger('renderer.system-preferences')

const FALLBACK: ElectronSystemPreferences = {
  locale: 'en',
  preferredLanguages: ['en'],
  colorScheme: 'light'
}

export function useSystemPreferences(): ElectronSystemPreferences | null {
  const available = isSystemApiAvailable()
  const [preferences, setPreferences] = useState<ElectronSystemPreferences | null>(
    available ? null : FALLBACK
  )

  useEffect(() => {
    if (!available) return

    let cancelled = false
    void systemClient
      .getSystemPreferences()
      .then((value) => {
        if (!cancelled) setPreferences(value)
      })
      .catch((error) => {
        log.warn('failed to load system preferences; using defaults', error)
        if (!cancelled) setPreferences(FALLBACK)
      })
    const unsubscribe = systemClient.onSystemPreferencesChanged((value) => setPreferences(value))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [available])

  return preferences
}

export function useResolvedColorScheme(): ElectronColorScheme {
  const preferences = useSystemPreferences()
  return preferences?.colorScheme ?? 'light'
}
