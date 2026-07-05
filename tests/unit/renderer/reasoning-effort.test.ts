import { describe, expect, it } from 'vitest'
import type { ProviderOptionSchema } from '@shared/provider'
import {
  DEFAULT_REASONING_EFFORT,
  reasoningEffortCycle,
  reasoningEffortField,
  reasoningEffortFromDefaults
} from '@renderer/features/chat/model/reasoning-effort'

const openaiSchema: ProviderOptionSchema = {
  providerId: 'openai',
  family: 'language',
  providerKey: 'openai',
  label: 'OpenAI language options',
  fields: [
    {
      path: 'reasoningEffort',
      label: 'Reasoning effort',
      control: 'select',
      role: 'reasoningEffort',
      choices: ['low', 'high'].map((value) => ({ value, label: value }))
    },
    { path: 'serviceTier', label: 'Service tier', control: 'string' }
  ]
}

const googleSchema: ProviderOptionSchema = {
  providerId: 'google',
  family: 'language',
  providerKey: 'google',
  label: 'Google language options',
  fields: [
    {
      path: 'thinkingConfig.thinkingLevel',
      label: 'Thinking level',
      control: 'select',
      role: 'reasoningEffort',
      choices: ['minimal', 'high'].map((value) => ({ value, label: value }))
    }
  ]
}

describe('chat/model/reasoning-effort (schema-driven)', () => {
  it('locates the effort field via the role annotation', () => {
    expect(reasoningEffortField([openaiSchema])).toEqual({
      path: 'reasoningEffort',
      providerKey: 'openai',
      choices: ['low', 'high']
    })
    expect(reasoningEffortField([googleSchema])?.path).toBe('thinkingConfig.thinkingLevel')
    expect(reasoningEffortField([{ ...openaiSchema, fields: [openaiSchema.fields[1]] }])).toBeNull()
    expect(reasoningEffortField(undefined)).toBeNull()
  })

  it('cycles default first, then schema choices', () => {
    const field = reasoningEffortField([openaiSchema])!
    expect(reasoningEffortCycle(field)).toEqual([DEFAULT_REASONING_EFFORT, 'low', 'high'])
  })

  it('reads the provider-defaults effort from plain, scoped, and raw shapes', () => {
    const field = reasoningEffortField([openaiSchema])!
    const empty = { providerOptions: {}, rawProviderOptions: {} }
    expect(reasoningEffortFromDefaults(field, empty)).toBeNull()
    expect(
      reasoningEffortFromDefaults(field, {
        providerOptions: { reasoningEffort: 'low' },
        rawProviderOptions: {}
      })
    ).toBe('low')
    expect(
      reasoningEffortFromDefaults(field, {
        providerOptions: { openai: { reasoningEffort: 'high' } },
        rawProviderOptions: {}
      })
    ).toBe('high')
    // Scoped wins over plain, raw wins over both — matching the backend merge.
    expect(
      reasoningEffortFromDefaults(field, {
        providerOptions: { reasoningEffort: 'low', openai: { reasoningEffort: 'high' } },
        rawProviderOptions: {}
      })
    ).toBe('high')
    expect(
      reasoningEffortFromDefaults(field, {
        providerOptions: { reasoningEffort: 'low' },
        rawProviderOptions: { openai: { reasoningEffort: 'high' } }
      })
    ).toBe('high')

    const nested = reasoningEffortField([googleSchema])!
    expect(
      reasoningEffortFromDefaults(nested, {
        providerOptions: { thinkingConfig: { thinkingLevel: 'minimal' } },
        rawProviderOptions: {}
      })
    ).toBe('minimal')
  })
})
