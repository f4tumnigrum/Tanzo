import { describe, expect, it } from 'vitest'
import type { ProviderOptionSchema } from '@shared/provider'
import {
  DEFAULT_REASONING_EFFORT,
  reasoningEffortCycle,
  reasoningEffortField
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
      choices: ['low', 'high']
    })
    expect(reasoningEffortField([googleSchema])?.path).toBe('thinkingConfig.thinkingLevel')
    expect(reasoningEffortField([{ ...openaiSchema, fields: [openaiSchema.fields[1]] }])).toBeNull()
    expect(reasoningEffortField(undefined)).toBeNull()
  })

  it('cycles default first, then the full schema choices', () => {
    const field = reasoningEffortField([openaiSchema])!
    expect(reasoningEffortCycle(field)).toEqual([DEFAULT_REASONING_EFFORT, 'low', 'high'])
    // The full set — no step is ever dropped, so the badge can reach every value.
    const anthropic = reasoningEffortField([
      {
        ...openaiSchema,
        fields: [
          {
            ...openaiSchema.fields[0],
            choices: ['low', 'high', 'max'].map((v) => ({ value: v, label: v }))
          }
        ]
      }
    ])!
    expect(reasoningEffortCycle(anthropic)).toEqual([
      DEFAULT_REASONING_EFFORT,
      'low',
      'high',
      'max'
    ])
  })
})
