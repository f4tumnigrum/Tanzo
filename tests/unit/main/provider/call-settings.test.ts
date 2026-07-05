import { describe, expect, it } from 'vitest'
import { coerceCallSettings, parseCallSettings } from '@main/provider/call-settings'

describe('main/provider/call-settings', () => {
  it('accepts valid settings on the strict path', () => {
    const settings = {
      maxRetries: 3,
      maxOutputTokens: 4096,
      temperature: 0.4,
      topP: 0.9,
      topK: 30,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      seed: 42,
      stopSequences: ['DONE']
    }
    expect(parseCallSettings(settings)).toEqual(settings)
    expect(parseCallSettings({})).toEqual({})
  })

  it('rejects unknown keys with the offending name in the message', () => {
    expect(() => parseCallSettings({ temperatuer: 0.4 })).toThrowError(/temperatuer/)
    try {
      parseCallSettings({ temperatuer: 0.4 })
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROVIDER_CALL_SETTINGS_INVALID' })
    }
  })

  it('rejects mistyped values on the strict path', () => {
    expect(() => parseCallSettings({ temperature: '0.7' })).toThrowError(/temperature/)
    expect(() => parseCallSettings({ maxOutputTokens: Number.NaN })).toThrowError(/maxOutputTokens/)
    expect(() => parseCallSettings({ stopSequences: ['ok', 7] })).toThrowError(/stopSequences/)
  })

  it('drops junk field by field on the lenient path', () => {
    expect(
      coerceCallSettings({
        temperature: 0.4,
        maxOutputTokens: Number.NaN,
        topP: 'high',
        stopSequences: ['ok', 7],
        unknown: true
      })
    ).toEqual({ temperature: 0.4 })
    expect(coerceCallSettings({})).toEqual({})
  })
})
