import { describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '@main/agent/agents/types'
import { buildAgentCall } from '@main/agent/runtime/build-agent'

const agentDef: AgentDefinition = {
  id: 'main',
  name: 'Main',
  description: 'Main agent',
  kind: 'main',
  modelRef: 'openai:gpt-4.1',
  systemPrompt: 'Be useful.',
  allowedTools: null,
  maxSteps: 7
}

describe('agent/runtime', () => {
  it('assembles a streamText call with provider settings, stop conditions, and policy metadata', () => {
    const decide = vi.fn(() => ({ type: 'approved' as const }))
    const telemetry = { isEnabled: true, integrations: [] }
    const providerService = {
      resolveLanguageModel: vi.fn(() => ({ model: 'language-model' })),
      getProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: 'low' } })),
      getCallSettings: vi.fn(() => ({
        maxRetries: 3,
        maxOutputTokens: 1000,
        temperature: 0.4,
        topP: 0.9,
        topK: 30,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        seed: 42,
        stopSequences: ['DONE', 'STOP']
      }))
    }
    const tools = {
      fileEdit: {
        metadata: {
          tanzo: { kind: 'edit', fingerprintFields: ['path', 4, 'oldText'] }
        }
      }
    }

    const call = buildAgentCall({
      def: agentDef,
      chatId: 'chat-1',
      mode: 'acceptEdits',
      providerService: providerService as never,
      tools: tools as never,
      decide,
      telemetry
    })

    expect(call).toMatchObject({
      model: { model: 'language-model' },
      tools,
      runtimeContext: { chatId: 'chat-1', mode: 'acceptEdits' },
      reasoning: 'low',
      telemetry
    })
    expect(call.stopWhen).toHaveLength(1)
    for (const condition of call.stopWhen) expect(typeof condition).toBe('function')
    expect(call.callSettings).toMatchObject({
      maxRetries: 3,
      maxOutputTokens: 1000,
      temperature: 0.4,
      topP: 0.9,
      topK: 30,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      seed: 42,
      stopSequences: ['DONE', 'STOP']
    })
    expect(providerService.resolveLanguageModel).toHaveBeenCalledWith('openai:gpt-4.1')
    expect(providerService.getProviderOptions).toHaveBeenCalledWith('openai', 'language')
    expect(providerService.getCallSettings).toHaveBeenCalledWith('openai', 'language')

    call.toolApproval({
      tools,
      toolCall: { toolName: 'fileEdit', input: { path: 'a.ts', oldText: 'a' } },
      messages: [{ role: 'user' }] as never,
      runtimeContext: { chatId: 'chat-1' }
    })
    expect(decide).toHaveBeenCalledWith({
      toolCall: {
        toolName: 'fileEdit',
        input: { path: 'a.ts', oldText: 'a' },
        kind: 'edit',
        fingerprintFields: ['path', 'oldText']
      },
      messages: [{ role: 'user' }],
      runtimeContext: { chatId: 'chat-1' }
    })
  })

  it('passes conversation reasoning through the SDK top-level setting', () => {
    const providerService = {
      resolveLanguageModel: vi.fn(() => 'model'),
      getProviderOptions: vi.fn(() => ({ openai: { serviceTier: 'priority' } })),
      getCallSettings: vi.fn(() => ({}))
    }

    const call = buildAgentCall({
      def: agentDef,
      chatId: 'chat-3',
      mode: 'default',
      providerService: providerService as never,
      tools: {} as never,
      decide: vi.fn(),
      reasoningEffort: 'high'
    })

    expect(call.providerOptions).toEqual({
      openai: { serviceTier: 'priority' }
    })
    expect(call.reasoning).toBe('high')
  })

  it('omits the maxSteps stop condition and provider options when absent', () => {
    const providerService = {
      resolveLanguageModel: vi.fn(() => 'model'),
      getProviderOptions: vi.fn(() => ({})),
      getCallSettings: vi.fn(() => ({}))
    }

    const call = buildAgentCall({
      def: { ...agentDef, maxSteps: undefined },
      chatId: 'chat-2',
      mode: 'default',
      providerService: providerService as never,
      tools: { shell: { metadata: { tanzo: { kind: 'exec' } } } } as never,
      decide: vi.fn()
    })

    expect(call.providerOptions).toBeUndefined()
    expect(call.stopWhen).toHaveLength(0)
    // Runtime default when the user has not configured retries.
    expect(call.callSettings).toEqual({ maxRetries: 5 })
  })

  it('adds the x-grok-conv-id header for Grok models keyed on the conversation', () => {
    const providerService = {
      resolveLanguageModel: vi.fn(() => 'model'),
      getProviderOptions: vi.fn(() => ({})),
      getCallSettings: vi.fn(() => ({}))
    }

    const call = buildAgentCall({
      def: { ...agentDef, modelRef: 'grok:grok-4.5' },
      chatId: 'chat-42',
      mode: 'default',
      providerService: providerService as never,
      tools: {} as never,
      decide: vi.fn()
    })

    expect(call.headers).toEqual({ 'x-grok-conv-id': 'chat-42' })
  })

  it('omits conversation headers for non-Grok providers', () => {
    const providerService = {
      resolveLanguageModel: vi.fn(() => 'model'),
      getProviderOptions: vi.fn(() => ({})),
      getCallSettings: vi.fn(() => ({}))
    }

    const call = buildAgentCall({
      def: agentDef,
      chatId: 'chat-1',
      mode: 'default',
      providerService: providerService as never,
      tools: {} as never,
      decide: vi.fn()
    })

    expect(call.headers).toBeUndefined()
  })
})
