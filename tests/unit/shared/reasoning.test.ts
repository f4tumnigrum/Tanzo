import { describe, expect, it } from 'vitest'
import type { ProviderReasoningCapability } from '@shared/provider'
import { reasoningEffortOverlayValue, resolveReasoningControl } from '@shared/reasoning'

const openai: ProviderReasoningCapability = {
  providerId: 'openai',
  family: 'language',
  effort: {
    providerKey: 'openai',
    path: 'reasoningEffort',
    values: ['low', 'medium', 'high'],
    default: 'high'
  }
}

const google: ProviderReasoningCapability = {
  providerId: 'google',
  family: 'language',
  effort: {
    providerKey: 'google',
    path: 'thinkingConfig.thinkingLevel',
    values: ['minimal', 'low', 'high'],
    default: 'high'
  }
}

describe('shared/reasoning resolveReasoningControl', () => {
  it('hides when capability has no effort', () => {
    expect(
      resolveReasoningControl({
        capability: { providerId: 'openai', family: 'language', effort: null }
      })
    ).toMatchObject({ visible: false, options: [] })
  })

  it('hides when the model is not explicitly reasoning capable', () => {
    expect(
      resolveReasoningControl({ capability: openai, modelReasoningCapable: false })
    ).toMatchObject({ visible: false })
    expect(resolveReasoningControl({ capability: openai })).toMatchObject({ visible: false })
  })

  it('prefers the conversation override', () => {
    expect(
      resolveReasoningControl({
        capability: openai,
        modelReasoningCapable: true,
        override: 'low'
      })
    ).toMatchObject({
      visible: true,
      current: 'low',
      source: 'override'
    })
  })

  it('falls back to the provider default when there is no override', () => {
    expect(
      resolveReasoningControl({
        capability: openai,
        modelReasoningCapable: true,
        providerDefault: 'medium'
      })
    ).toMatchObject({ current: 'medium', source: 'provider-default' })
  })

  it('falls back to the capability default last', () => {
    expect(
      resolveReasoningControl({ capability: openai, modelReasoningCapable: true })
    ).toMatchObject({
      current: 'high',
      source: 'capability-default'
    })
  })

  it('treats the literal "default" and out-of-range values as no selection', () => {
    expect(
      resolveReasoningControl({
        capability: openai,
        modelReasoningCapable: true,
        override: 'default',
        providerDefault: 'xhigh'
      })
    ).toMatchObject({ current: 'high', source: 'capability-default' })
  })
})

describe('shared/reasoning reasoningEffortOverlayValue', () => {
  it('builds a flat overlay', () => {
    expect(reasoningEffortOverlayValue(openai, 'low')).toEqual({
      providerKey: 'openai',
      value: { reasoningEffort: 'low' }
    })
  })

  it('expands a nested path', () => {
    expect(reasoningEffortOverlayValue(google, 'high')).toEqual({
      providerKey: 'google',
      value: { thinkingConfig: { thinkingLevel: 'high' } }
    })
  })

  it('drops values outside the capability range', () => {
    expect(reasoningEffortOverlayValue(openai, 'xhigh')).toBeNull()
    expect(reasoningEffortOverlayValue(openai, 'default')).toBeNull()
  })
})
