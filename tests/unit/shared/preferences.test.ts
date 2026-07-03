import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, PREFERENCES_CHANNELS } from '@shared/preferences'

describe('shared/preferences', () => {
  it('defines stable defaults and IPC channel names', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      themeMode: 'system',
      colorThemeId: 'tanzo',
      radiusPresetId: 'balanced',
      densityPresetId: 'comfortable',
      typography: {
        fontSize: 16,
        codeFontSize: 11,
        lineHeight: 1.72,
        sansFont: null,
        monoFont: null
      },
      language: null,
      customThemes: [],
      reasoningExpandedByDefault: true
    })
    expect(PREFERENCES_CHANNELS.changed).toBe('preferences:changed')
  })
})
