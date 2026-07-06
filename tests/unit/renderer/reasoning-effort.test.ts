import { describe, expect, it } from 'vitest'
import type { ProviderOptionSchema } from '@shared/provider'
import {
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
      default: 'high',
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
      default: 'high',
      choices: ['minimal', 'high'].map((value) => ({ value, label: value }))
    }
  ]
}

describe('chat/model/reasoning-effort (schema-driven)', () => {
  it('locates the effort field via the role annotation', () => {
    expect(reasoningEffortField([openaiSchema])).toEqual({
      path: 'reasoningEffort',
      choices: ['low', 'high'],
      default: 'high'
    })
    expect(reasoningEffortField([googleSchema])?.path).toBe('thinkingConfig.thinkingLevel')
    expect(reasoningEffortField([{ ...openaiSchema, fields: [openaiSchema.fields[1]] }])).toBeNull()
    expect(reasoningEffortField(undefined)).toBeNull()
  })

  it('reports the schema default, falling back to the first choice when unmarked', () => {
    const noDefault = reasoningEffortField([
      {
        ...openaiSchema,
        fields: [{ ...openaiSchema.fields[0], default: undefined }]
      }
    ])!
    expect(noDefault.default).toBe('low')

    const staleDefault = reasoningEffortField([
      {
        ...openaiSchema,
        fields: [{ ...openaiSchema.fields[0], default: 'medium' }]
      }
    ])!
    // A default outside the choices falls back to the first choice.
    expect(staleDefault.default).toBe('low')
  })

  it('cycles the provider choices only — no synthetic "no override" step', () => {
    const field = reasoningEffortField([openaiSchema])!
    expect(reasoningEffortCycle(field)).toEqual(['low', 'high'])
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
    expect(reasoningEffortCycle(anthropic)).toEqual(['low', 'high', 'max'])
  })
})
