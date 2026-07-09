import { describe, expect, it } from 'vitest'
import type { ProviderDefaultsState } from '@shared/provider'
import {
  EMPTY_DEFAULTS,
  listOptionSchemas,
  mergeProviderOptions,
  mergeProviderOptionsInto,
  normalizeDefaults,
  normalizeStoredDefaults,
  reasoningEffortOverlay,
  validateProviderOptions
} from '@main/provider/options'

describe('main/provider/options', () => {
  it('filters option schemas by provider and family', () => {
    const openaiLanguage = listOptionSchemas('openai', 'language')
    expect(openaiLanguage).toHaveLength(1)
    expect(openaiLanguage[0]).toMatchObject({
      providerId: 'openai',
      family: 'language',
      providerKey: 'openai'
    })
    expect(openaiLanguage[0].fields.map((field) => field.path)).not.toContain('reasoningEffort')
    expect(listOptionSchemas('openai-compatible', 'language')[0]).toMatchObject({
      providerId: 'openai-compatible',
      family: 'language',
      providerKey: 'openaiCompatible'
    })

    expect(listOptionSchemas().every((schema) => schema.family === 'language')).toBe(true)
    expect(listOptionSchemas('openai', 'embedding')).toEqual([])
    expect(listOptionSchemas('google', 'image')).toEqual([])
    expect(listOptionSchemas('deepseek', 'embedding')).toEqual([])
  })

  it('normalizes missing and partial default state', () => {
    expect(normalizeDefaults(undefined)).toEqual(EMPTY_DEFAULTS)
    expect(normalizeDefaults({ callDefaults: { temperature: 0.2 } })).toEqual({
      callDefaults: { temperature: 0.2 },
      providerOptions: {},
      rawProviderOptions: {}
    })
  })

  it('normalizes stored default state', () => {
    expect(
      normalizeStoredDefaults({
        callDefaults: {},
        providerOptions: { reasoningEffort: 'high' },
        rawProviderOptions: {}
      })
    ).toEqual({
      callDefaults: {},
      providerOptions: { reasoningEffort: 'high' },
      rawProviderOptions: {}
    })
    expect(normalizeStoredDefaults(undefined)).toEqual(EMPTY_DEFAULTS)
  })

  it('scopes unqualified provider options under the matching provider key', () => {
    const defaults: ProviderDefaultsState = {
      callDefaults: {},
      providerOptions: {
        reasoningEffort: 'high',
        openai: { textVerbosity: 'low' },
        anthropic: { effort: 'medium' }
      },
      rawProviderOptions: {
        openai: { serviceTier: 'priority' }
      }
    }

    expect(mergeProviderOptions(defaults, 'openai', 'language')).toEqual({
      openai: {
        reasoningEffort: 'high',
        textVerbosity: 'low',
        serviceTier: 'priority'
      },
      anthropic: { effort: 'medium' }
    })
  })

  it('uses the camelCase key for OpenAI-compatible provider options', () => {
    const defaults: ProviderDefaultsState = {
      callDefaults: {},
      providerOptions: {
        reasoningEffort: 'high',
        'openai-compatible': { textVerbosity: 'low' }
      },
      rawProviderOptions: {
        'openai-compatible': { strictJsonSchema: false }
      }
    }

    expect(mergeProviderOptions(defaults, 'openai-compatible', 'language')).toEqual({
      openaiCompatible: {
        reasoningEffort: 'high',
        textVerbosity: 'low',
        strictJsonSchema: false
      }
    })
  })

  it('builds reasoning-effort overlays from the provider reasoning capability', () => {
    expect(reasoningEffortOverlay('openai', 'high')).toEqual({
      openai: { reasoningEffort: 'high' }
    })
    expect(reasoningEffortOverlay('anthropic', 'xhigh')).toEqual({
      anthropic: { effort: 'xhigh' }
    })
    expect(reasoningEffortOverlay('deepseek', 'low')).toEqual({
      deepseek: { reasoningEffort: 'low' }
    })
    expect(reasoningEffortOverlay('zhipu', 'high')).toBeUndefined()
    expect(reasoningEffortOverlay('minimax', 'medium')).toEqual({
      minimax: { reasoningEffort: 'medium' }
    })
    expect(reasoningEffortOverlay('grok', 'medium')).toEqual({
      xai: { reasoningEffort: 'medium' }
    })
    expect(reasoningEffortOverlay('grok', 'xhigh')).toBeUndefined()
    expect(reasoningEffortOverlay('google', 'medium')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'medium' } }
    })
    expect(reasoningEffortOverlay('openai-compatible', 'minimal')).toEqual({
      openaiCompatible: { reasoningEffort: 'minimal' }
    })
    expect(reasoningEffortOverlay('openai', 'max')).toBeUndefined()
    expect(reasoningEffortOverlay('google', 'xhigh')).toBeUndefined()
    expect(reasoningEffortOverlay('openai-compatible', 'ultra-think')).toBeUndefined()
  })

  it('validates structured provider option values', () => {
    expect(() => validateProviderOptions('openai', 'language', { logprobs: 1 })).not.toThrow()
    expect(() => validateProviderOptions('openai', 'language', { logprobs: 0 })).toThrow(/logprobs/)
    expect(() => validateProviderOptions('openai', 'language', { logprobs: 21 })).toThrow(
      /logprobs/
    )
  })

  it('deep-merges provider option overrides without mutating inputs', () => {
    const base = { openai: { metadata: { a: 1 }, serviceTier: 'auto' } }
    const overrides = { openai: { metadata: { b: 2 } } }

    expect(mergeProviderOptionsInto(base, overrides)).toEqual({
      openai: { metadata: { a: 1, b: 2 }, serviceTier: 'auto' }
    })
    expect(base).toEqual({ openai: { metadata: { a: 1 }, serviceTier: 'auto' } })
  })
})
