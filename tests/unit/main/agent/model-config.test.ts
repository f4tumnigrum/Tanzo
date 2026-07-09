import { describe, expect, it, vi } from 'vitest'
import type { ProviderId } from '@shared/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { resolveLanguageModelConfig } from '@main/agent/runtime/model-config'
import type { ProviderService } from '@main/provider/service'

function service(providerOptions: ProviderOptions): ProviderService {
  return {
    getCallSettings: vi.fn(() => ({})),
    getProviderOptions: vi.fn(() => providerOptions),
    resolveLanguageModel: vi.fn(() => ({ modelId: 'test' }))
  } as unknown as ProviderService
}

function resolve(providerId: ProviderId, providerOptions: ProviderOptions, effort?: string) {
  return resolveLanguageModelConfig(
    service(providerOptions),
    `${providerId}:model`,
    effort ? { reasoningEffort: effort } : undefined
  )
}

describe('agent/runtime/model-config', () => {
  it('uses top-level reasoning and removes the legacy xAI effort override', () => {
    const config = resolve('grok', { xai: { reasoningEffort: 'high', store: false } }, 'medium')

    expect(config.reasoning).toBe('medium')
    expect(config.providerOptions).toEqual({ xai: { store: false } })
  })

  it('lets AI SDK map Google and Anthropic reasoning by model', () => {
    const google = resolve('google', {
      google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } }
    })
    expect(google.reasoning).toBe('high')
    expect(google.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true } }
    })

    const anthropic = resolve('anthropic', { anthropic: { effort: 'xhigh', sendReasoning: true } })
    expect(anthropic.reasoning).toBe('xhigh')
    expect(anthropic.providerOptions).toEqual({ anthropic: { sendReasoning: true } })
  })

  it('drops the unsupported legacy Zhipu reasoning-effort field', () => {
    const config = resolve('zhipu', {
      zhipu: { reasoningEffort: 'high', thinking: { type: 'enabled' } }
    })

    expect(config.reasoning).toBeUndefined()
    expect(config.providerOptions).toEqual({ zhipu: { thinking: { type: 'enabled' } } })
  })

  it('keeps MiniMax effort in provider options for its V3 adapter', () => {
    const config = resolve('minimax', { minimax: { textVerbosity: 'low' } }, 'medium')

    expect(config.reasoning).toBeUndefined()
    expect(config.providerOptions).toEqual({
      minimax: { textVerbosity: 'low', reasoningEffort: 'medium' }
    })
  })
})
