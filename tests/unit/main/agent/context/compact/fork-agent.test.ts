import { NoOutputGeneratedError } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '@main/agent/agents/types'
import { runCompactionFork } from '@main/agent/context/compact/fork-agent'

const mocks = vi.hoisted(() => {
  const streamText = vi.fn((options: Record<string, unknown>) => {
    const step = {
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 5 }
      },
      finishReason: 'stop',
      providerMetadata: { provider: 'mock' }
    }
    return {
      text: Promise.resolve().then(async () => {
        await (options.prepareStep as ((i: unknown) => Promise<unknown>) | undefined)?.({
          stepNumber: 0,
          steps: [],
          model: {},
          messages: options.messages,
          initialMessages: options.messages,
          responseMessages: [],
          toolsContext: {},
          runtimeContext: {}
        })
        await (options.onStepEnd as ((s: unknown) => void | Promise<void>) | undefined)?.(step)
        return '<summary>condensed</summary>'
      }),
      usage: Promise.resolve(step.usage)
    }
  })
  return {
    streamText,
    isStepCount: vi.fn((count: number) => `step-count:${count}`)
  }
})

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    isStepCount: mocks.isStepCount,
    streamText: mocks.streamText
  }
})

const def: AgentDefinition = {
  id: 'main',
  name: 'Main',
  description: 'Main agent',
  kind: 'main',
  modelRef: 'openai:gpt',
  systemPrompt: 'System',
  allowedTools: null
}

describe('main/agent/context/compact/fork-agent', () => {
  function createDeps() {
    const tools = { shell: {} }
    const prepared = {
      instructions: [{ role: 'system', content: 'System' }],
      messages: [{ role: 'user', content: 'old transcript' }],
      providerOptions: { anthropic: {} }
    }
    return {
      providerService: {
        resolveLanguageModel: vi.fn(() => ({ provider: 'openai', modelId: 'gpt' })),
        getCallSettings: vi.fn(() => ({ maxOutputTokens: 1024, temperature: 0.2 })),
        getProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: 'low' } }))
      },
      policy: {
        getMode: vi.fn(() => 'default'),
        decide: vi.fn()
      },
      store: {
        rootOf: vi.fn(() => 'chat-1'),
        depthOf: vi.fn(() => 0),
        getLatestPromptDiagnostic: vi.fn(() => undefined),
        recordPromptDiagnostic: vi.fn(),
        finishPromptDiagnostic: vi.fn()
      },
      buildTools: vi.fn(async () => tools),
      contextEngine: {
        build: vi.fn(async () => prepared)
      },
      identity: {},
      send: vi.fn(),
      logger: { warn: vi.fn(), info: vi.fn() }
    }
  }

  it('forks the parent agent using an empty tool set — compaction never calls tools', async () => {
    const abort = new AbortController()
    const deps = createDeps()

    const result = await runCompactionFork(deps as never, {
      chatId: 'chat-1',
      def,
      cwd: '/repo',
      runId: 'run-1',
      head: [{ role: 'user', content: 'old transcript' }],
      prompt: 'compact now',
      telemetry: { isEnabled: true, integrations: [] },
      abortSignal: abort.signal
    })

    expect(result).toEqual({
      text: '<summary>condensed</summary>',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        cacheReadTokens: 80,
        cacheWriteTokens: 5
      }
    })

    // buildTools must NOT be called: the fork runs with toolChoice:'none'
    // and building the full tool set (MCP servers etc.) is wasted work.
    expect(deps.buildTools).not.toHaveBeenCalled()
    expect(deps.contextEngine.build).toHaveBeenCalledWith(
      def,
      'chat-1',
      '/repo',
      // basePrepareStep passes initialMessages directly (the full messages array
      // passed to streamText: head + prompt). responseMessages is always empty
      // for step 0 in a single-step fork, so the old spread was a no-op.
      [
        { role: 'user', content: 'old transcript' },
        { role: 'user', content: 'compact now' }
      ],
      0,
      { consumeGoalInjection: false }
    )
    expect(deps.providerService.resolveLanguageModel).toHaveBeenCalledWith('openai:gpt')
    expect(deps.providerService.getCallSettings).toHaveBeenCalledWith('openai', 'language')
    expect(deps.providerService.getProviderOptions).toHaveBeenCalledWith('openai', 'language')
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: 'openai', modelId: 'gpt' },
        tools: {},
        toolChoice: 'none',
        stopWhen: ['step-count:1'],
        runtimeContext: { chatId: 'chat-1', mode: 'default' },
        maxOutputTokens: 1024,
        temperature: 0.2,
        providerOptions: { openai: { reasoningEffort: 'low' } },
        telemetry: { isEnabled: true, integrations: [] },
        prepareStep: expect.any(Function),
        messages: [
          { role: 'user', content: 'old transcript' },
          { role: 'user', content: 'compact now' }
        ],
        abortSignal: abort.signal
      })
    )
  })

  it('records prompt-cache diagnostics for the fork step', async () => {
    const deps = createDeps()

    await runCompactionFork(deps as never, {
      chatId: 'chat-1',
      def,
      cwd: '/repo',
      runId: 'run-1',
      head: [{ role: 'user', content: 'old transcript' }],
      prompt: 'compact now'
    })

    expect(deps.store.recordPromptDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'chat-1', runId: 'run-1', stepNumber: 1 })
    )
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

  it('includes API response details when streamText returns non-JSON content', async () => {
    const error = new Error('Invalid JSON response') as Error & {
      statusCode: number
      responseHeaders: Record<string, string>
      responseBody: string
    }
    error.statusCode = 502
    error.responseHeaders = { 'content-type': 'text/html; charset=utf-8' }
    error.responseBody = '<html>bad gateway</html>'
    mocks.streamText.mockReturnValueOnce({
      text: Promise.reject(error),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    })

    await expect(
      runCompactionFork(createDeps() as never, {
        chatId: 'chat-1',
        def,
        cwd: '/repo',
        runId: 'run-1',
        head: [{ role: 'user', content: 'old transcript' }],
        prompt: 'compact now'
      })
    ).rejects.toThrow(
      'Compaction stream failed: Invalid JSON response (status 502; content-type text/html; charset=utf-8; response body: <html>bad gateway</html>)'
    )
  })

  it('returns a summary that hit the model output token limit', async () => {
    mocks.streamText.mockImplementationOnce((options: Record<string, unknown>) => ({
      text: Promise.resolve().then(async () => {
        await (options.onStepEnd as ((s: unknown) => void | Promise<void>) | undefined)?.({
          usage: { inputTokens: 100, outputTokens: 1024, totalTokens: 1124 },
          finishReason: 'length',
          providerMetadata: {}
        })
        return '<summary>partial summary cut off'
      }),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 1024, totalTokens: 1124 })
    }))

    await expect(
      runCompactionFork(createDeps() as never, {
        chatId: 'chat-1',
        def,
        cwd: '/repo',
        runId: 'run-1',
        head: [{ role: 'user', content: 'old transcript' }],
        prompt: 'compact now'
      })
    ).resolves.toEqual({
      text: '<summary>partial summary cut off',
      usage: { inputTokens: 100, outputTokens: 1024, totalTokens: 1124 }
    })
  })

  it('throws when streamText fails', async () => {
    mocks.streamText.mockImplementationOnce(() => {
      throw new Error('stream_read_error')
    })

    await expect(
      runCompactionFork(createDeps() as never, {
        chatId: 'chat-1',
        def,
        cwd: '/repo',
        runId: 'run-1',
        head: [{ role: 'user', content: 'old transcript' }],
        prompt: 'compact now'
      })
    ).rejects.toThrow('Compaction stream failed: stream_read_error')
  })

  it('surfaces the underlying stream error instead of the masked NoOutputGeneratedError', async () => {
    const real = new Error('upstream provider returned 429 rate limit') as Error & {
      statusCode: number
    }
    real.statusCode = 429
    const masked = new NoOutputGeneratedError({
      message: 'No output generated. Check the stream for errors.'
    })
    mocks.streamText.mockImplementationOnce((options: Record<string, unknown>) => ({
      text: Promise.resolve().then(async () => {
        await (options.onError as ((e: { error: unknown }) => void | Promise<void>) | undefined)?.({
          error: real
        })
        throw masked
      }),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    }))

    await expect(
      runCompactionFork(createDeps() as never, {
        chatId: 'chat-1',
        def,
        cwd: '/repo',
        runId: 'run-1',
        head: [{ role: 'user', content: 'old transcript' }],
        prompt: 'compact now'
      })
    ).rejects.toThrow(
      'Compaction stream failed: upstream provider returned 429 rate limit (status 429)'
    )
  })
})
