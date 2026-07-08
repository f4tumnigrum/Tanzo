import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recordFinishedStepDiagnostic,
  recordPreparedStepDiagnostic,
  resetPromptDiagnosticModeCache
} from '@main/agent/runtime/prompt-diagnostics'
import type { AgentDefinition } from '@main/agent/agents/types'

vi.mock('@main/agent/diagnostics/prompt-cache', () => ({
  buildPromptCacheDiagnostic: vi.fn((input: unknown) => ({ built: input })),
  stableStringify: vi.fn((value: unknown) => JSON.stringify(value))
}))

const def: AgentDefinition = {
  id: 'main',
  name: 'Main',
  description: 'Main agent',
  kind: 'main',
  modelRef: 'anthropic:claude',
  systemPrompt: 'System',
  allowedTools: null
}

function createDeps() {
  return {
    store: {
      getLatestPromptDiagnostic: vi.fn(() => undefined),
      ensureRunStep: vi.fn(),
      recordPromptDiagnostic: vi.fn(),
      finishPromptDiagnostic: vi.fn()
    },
    logger: { warn: vi.fn() }
  }
}

afterEach(() => {
  delete process.env.TANZO_PROMPT_DIAGNOSTICS
  resetPromptDiagnosticModeCache()
})

describe('main/agent/runtime/prompt-diagnostics', () => {
  it('records a prepared-step diagnostic from the built record', () => {
    const deps = createDeps()
    recordPreparedStepDiagnostic(deps as never, {
      chatId: 'chat-1',
      runId: 'run-1',
      stepNumber: 1,
      def,
      tools: { shell: {} } as never,
      prepared: { system: [], messages: [] }
    })

    expect(deps.store.recordPromptDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        built: expect.objectContaining({ conversationId: 'chat-1', runId: 'run-1', stepNumber: 1 })
      })
    )
  })

  it('maps unified usage cache fields onto the finished-step record', () => {
    const deps = createDeps()
    recordFinishedStepDiagnostic(deps as never, {
      chatId: 'chat-1',
      runId: 'run-1',
      stepNumber: 1,
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 5 }
      },
      finishReason: 'stop'
    })

    expect(deps.store.finishPromptDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'chat-1',
        runId: 'run-1',
        stepNumber: 1,
        inputTokens: 100,
        cacheReadTokens: 80,
        cacheWriteTokens: 5
      })
    )
  })

  it('falls back to cachedInputTokens for cache reads', () => {
    const deps = createDeps()
    recordFinishedStepDiagnostic(deps as never, {
      chatId: 'chat-1',
      runId: 'run-1',
      stepNumber: 1,
      usage: { inputTokens: 100, cachedInputTokens: 40 }
    })

    expect(deps.store.finishPromptDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ cacheReadTokens: 40 })
    )
  })

  it('swallows record errors and warns', () => {
    const deps = createDeps()
    deps.store.recordPromptDiagnostic.mockImplementation(() => {
      throw new Error('db down')
    })

    expect(() =>
      recordPreparedStepDiagnostic(deps as never, {
        chatId: 'chat-1',
        runId: 'run-1',
        stepNumber: 1,
        def,
        tools: {} as never,
        prepared: {}
      })
    ).not.toThrow()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'prompt cache diagnostic record failed',
      expect.objectContaining({ chatId: 'chat-1' })
    )
  })

  it('in sampled mode records step 1 fully but only ensures run-step on non-sampled steps', () => {
    process.env.TANZO_PROMPT_DIAGNOSTICS = 'sampled'
    resetPromptDiagnosticModeCache()
    const deps = createDeps()

    const prepared = { def, tools: {} as never, prepared: { system: [], messages: [] } }
    // Step 1 -> full record (baseline). Step 2/3 -> ensureRunStep only. Step 4 -> full record.
    recordPreparedStepDiagnostic(deps as never, {
      chatId: 'c',
      runId: 'r',
      stepNumber: 1,
      ...prepared
    })
    recordPreparedStepDiagnostic(deps as never, {
      chatId: 'c',
      runId: 'r',
      stepNumber: 2,
      ...prepared
    })
    recordPreparedStepDiagnostic(deps as never, {
      chatId: 'c',
      runId: 'r',
      stepNumber: 3,
      ...prepared
    })
    recordPreparedStepDiagnostic(deps as never, {
      chatId: 'c',
      runId: 'r',
      stepNumber: 4,
      ...prepared
    })

    expect(deps.store.recordPromptDiagnostic).toHaveBeenCalledTimes(2)
    expect(deps.store.ensureRunStep).toHaveBeenCalledTimes(2)
    expect(deps.store.ensureRunStep).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c',
        runId: 'r',
        stepNumber: 2,
        provider: 'anthropic'
      })
    )
  })

  it('in off mode records nothing and skips the finish update', () => {
    process.env.TANZO_PROMPT_DIAGNOSTICS = 'off'
    resetPromptDiagnosticModeCache()
    const deps = createDeps()

    recordPreparedStepDiagnostic(deps as never, {
      chatId: 'c',
      runId: 'r',
      stepNumber: 1,
      def,
      tools: {} as never,
      prepared: {}
    })
    recordFinishedStepDiagnostic(deps as never, {
      chatId: 'c',
      runId: 'r',
      stepNumber: 1,
      usage: { inputTokens: 10 }
    })

    expect(deps.store.recordPromptDiagnostic).not.toHaveBeenCalled()
    expect(deps.store.ensureRunStep).not.toHaveBeenCalled()
    expect(deps.store.finishPromptDiagnostic).not.toHaveBeenCalled()
  })
})
