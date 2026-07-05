import { describe, expect, it } from 'vitest'
import { parseModelRef, requireModelRef } from '@shared/provider'

describe('shared/provider model refs', () => {
  it('parses provider:modelId refs', () => {
    expect(parseModelRef('openai:gpt-5')).toEqual({ providerId: 'openai', modelId: 'gpt-5' })
    expect(parseModelRef('anthropic:claude-opus-4-5')).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-5'
    })
    // Only the first separator splits; model ids may contain colons.
    expect(parseModelRef('openai-compatible:org:model')).toEqual({
      providerId: 'openai-compatible',
      modelId: 'org:model'
    })
  })

  it('rejects malformed or unknown refs', () => {
    expect(parseModelRef('gpt-5')).toBeUndefined()
    expect(parseModelRef('unknown:gpt-5')).toBeUndefined()
    expect(parseModelRef('openai:')).toBeUndefined()
    expect(parseModelRef('')).toBeUndefined()
  })

  it('requireModelRef throws a typed validation error', () => {
    expect(requireModelRef('openai:gpt-5')).toEqual({ providerId: 'openai', modelId: 'gpt-5' })
    expect(() => requireModelRef('nope')).toThrowError(/Invalid model ref: nope/)
    try {
      requireModelRef('nope')
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROVIDER_MODEL_REF_INVALID' })
    }
  })
})
