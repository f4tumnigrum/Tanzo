import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import { runSummarizeFork } from '@main/agent/context/compact/summarize'
import { compactModelTranscript } from '@main/agent/context/compact/inline'

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  calls: [] as Record<string, unknown>[]
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: aiMocks.streamText
  }
})

function mockStream(text = 'condensed summary', inputTokens = 1_000): void {
  aiMocks.streamText.mockImplementation((options: Record<string, unknown>) => {
    aiMocks.calls.push(options)
    const onStepEnd = options.onStepEnd as ((step: unknown) => void) | undefined
    onStepEnd?.({ usage: { inputTokens, outputTokens: 50, totalTokens: inputTokens + 50 } })
    return {
      text: Promise.resolve(text),
      usage: Promise.resolve({ inputTokens, outputTokens: 50 })
    }
  })
}

function makeDeps(contextWindow = 128_000) {
  return {
    providerService: {
      resolveLanguageModel: vi.fn(() => ({ model: 'lm' })),
      getCallSettings: vi.fn(() => ({})),
      getProviderOptions: vi.fn(() => ({}))
    } as never,
    contextEngine: {
      capabilitiesFor: vi.fn(() => ({
        contextWindow,
        maxOutputTokens: 8_192,
        supportsImages: false
      })),
      build: vi.fn(async (_def: unknown, _chat: unknown, _cwd: unknown, head: ModelMessage[]) => ({
        instructions: [{ role: 'system', content: 'MAIN SYSTEM' }],
        messages: [{ role: 'user', content: 'ENV' }, ...head],
        providerOptions: { openai: { promptCacheKey: 'tanzo:chat:c1' } }
      }))
    } as never,
    logger: { warn: vi.fn(), info: vi.fn() } as never
  }
}

const DEF = {
  id: 'main',
  name: 'Main',
  description: '',
  kind: 'main',
  modelRef: 'openai:gpt-5',
  systemPrompt: 'ROLE',
  allowedTools: null
} as never

const HEAD: ModelMessage[] = [
  { role: 'user', content: 'do the thing' },
  { role: 'assistant', content: 'done the thing' }
]

describe('compact/summarize — fork paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiMocks.calls.length = 0
  })

  it('path A: reuses the main prompt prefix when tools are provided', async () => {
    mockStream()
    const deps = makeDeps()
    const tools = { shell: { execute: vi.fn(), description: 'run' } } as never

    const result = await runSummarizeFork(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      head: HEAD,
      prompt: 'SUMMARIZE NOW',
      tools
    })

    expect(result.text).toBe('condensed summary')
    const call = aiMocks.calls[0]
    // Prefix reuse: engine-built system + messages, summarize prompt last.
    expect(call.instructions).toEqual([{ role: 'system', content: 'MAIN SYSTEM' }])
    const messages = call.messages as ModelMessage[]
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'SUMMARIZE NOW' })
    expect(messages[0]).toEqual({ role: 'user', content: 'ENV' })
    // Tools present (same serialization) but execute stripped.
    const toolSet = call.tools as Record<string, { execute?: unknown }>
    expect(toolSet.shell).toBeDefined()
    expect(toolSet.shell.execute).toBeUndefined()
    // Non-Anthropic: toolChoice none is free.
    expect(call.toolChoice).toBe('none')
  })

  it('path A is skipped for a dedicated compaction model', async () => {
    mockStream()
    const deps = makeDeps()
    const def = { ...(DEF as object), compactionModelRef: 'deepseek:deepseek-chat' } as never

    await runSummarizeFork(deps, {
      chatId: 'c1',
      def,
      cwd: '/tmp',
      runId: 'r1',
      head: HEAD,
      prompt: 'SUMMARIZE',
      tools: { shell: {} } as never
    })

    const call = aiMocks.calls[0]
    // Standalone summarizer: no main-agent system, no tools.
    expect(call.tools).toBeUndefined()
    expect(JSON.stringify(call.instructions)).toContain('summarization engine')
    expect((deps.contextEngine as { build: unknown }).build).not.toHaveBeenCalled()
  })

  it('anthropic path A keeps toolChoice auto to preserve the cached prefix', async () => {
    mockStream()
    const deps = makeDeps()
    const def = { ...(DEF as object), modelRef: 'anthropic:claude-opus-4-5' } as never

    await runSummarizeFork(deps, {
      chatId: 'c1',
      def,
      cwd: '/tmp',
      runId: 'r1',
      head: HEAD,
      prompt: 'SUMMARIZE',
      tools: { shell: {} } as never
    })

    expect(aiMocks.calls[0].toolChoice).toBeUndefined()
  })

  it('deep-merges user provider options with the built prompt-cache options', async () => {
    mockStream()
    const deps = makeDeps()
    ;(deps.providerService as { getProviderOptions: ReturnType<typeof vi.fn> }).getProviderOptions =
      vi.fn(() => ({ openai: { reasoningEffort: 'high' } }))

    await runSummarizeFork(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      head: HEAD,
      prompt: 'SUMMARIZE',
      tools: { shell: {} } as never
    })

    // Prompt cache options remain provider-scoped while reasoning is passed through
    // the SDK's model-aware top-level setting.
    expect(aiMocks.calls[0].providerOptions).toEqual({
      openai: { promptCacheKey: 'tanzo:chat:c1' }
    })
    expect(aiMocks.calls[0].reasoning).toBe('high')
  })

  it('inherits only the retry policy from user call settings', async () => {
    mockStream()
    const deps = makeDeps()
    ;(deps.providerService as { getCallSettings: ReturnType<typeof vi.fn> }).getCallSettings =
      vi.fn(() => ({ maxRetries: 2, temperature: 0.9, stopSequences: ['DONE'] }))

    await runSummarizeFork(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      head: HEAD,
      prompt: 'SUMMARIZE'
    })

    const call = aiMocks.calls[0]
    expect(call.maxRetries).toBe(2)
    // Conversation-tuned settings could truncate or distort the summary.
    expect(call.temperature).toBeUndefined()
    expect(call.stopSequences).toBeUndefined()
  })

  it('path B chunks a head that exceeds the fork window (rolling summary)', async () => {
    mockStream('rolling')
    // Tiny fork window forces chunking.
    const deps = makeDeps(1_000)
    const bigHead: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: `${i}-${'x'.repeat(2_000)}`
    }))

    const result = await runSummarizeFork(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      head: bigHead,
      prompt: 'FINAL INSTRUCTION'
    })

    expect(result.text).toBe('rolling')
    expect(aiMocks.calls.length).toBeGreaterThan(1)
    // Every chunked call is a standalone summarizer call.
    for (const call of aiMocks.calls) {
      expect(call.tools).toBeUndefined()
    }
    // Later calls carry the rolling summary forward.
    const secondContent = JSON.stringify((aiMocks.calls[1].messages as ModelMessage[])[0].content)
    expect(secondContent).toContain('Summary of the conversation so far')
    // The final chunk carries the real instruction.
    const lastContent = JSON.stringify(
      (aiMocks.calls.at(-1)!.messages as ModelMessage[])[0].content
    )
    expect(lastContent).toContain('FINAL INSTRUCTION')
  })

  it('surfaces the underlying stream error, not the generic NoOutputGenerated', async () => {
    aiMocks.streamText.mockImplementation((options: Record<string, unknown>) => {
      const onError = options.onError as ((event: { error: unknown }) => void) | undefined
      onError?.({ error: Object.assign(new Error('upstream 529'), { statusCode: 529 }) })
      return {
        text: Promise.reject(
          Object.assign(new Error('No output generated.'), {
            name: 'AI_NoOutputGeneratedError'
          })
        ),
        usage: Promise.resolve({})
      }
    })
    const deps = makeDeps()

    await expect(
      runSummarizeFork(deps, {
        chatId: 'c1',
        def: DEF,
        cwd: '/tmp',
        runId: 'r1',
        head: HEAD,
        prompt: 'SUMMARIZE'
      })
    ).rejects.toThrow(/Compaction stream failed/)
  })
})

describe('compact/inline — in-stream compaction with degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiMocks.calls.length = 0
  })

  const POLICY = {
    compactionTriggerTokens: 1_000,
    retainBudgetTokens: 500,
    hardCeilingTokens: 2_000
  }

  function longTranscript(): ModelMessage[] {
    const transcript: ModelMessage[] = [{ role: 'user', content: 'go' }]
    for (let i = 0; i < 6; i += 1) {
      transcript.push({ role: 'user', content: `q${i} ${'x'.repeat(2_000)}` })
      transcript.push({ role: 'assistant', content: `a${i}` })
    }
    return transcript
  }

  it('replaces the head with a summary message and keeps the tail', async () => {
    mockStream('the summary of old work')
    const deps = makeDeps()

    const result = await compactModelTranscript(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      transcript: longTranscript(),
      prompt: 'SUMMARIZE',
      policy: POLICY
    })

    expect(result).not.toBeNull()
    expect(result!.summaryText).toBe('the summary of old work')
    expect(result!.degraded).toBeUndefined()
    expect(result!.transcript[0]).toMatchObject({ role: 'assistant' })
    expect(JSON.stringify(result!.transcript[0].content)).toContain('the summary of old work')
    // Tail preserved verbatim.
    expect(result!.transcript.at(-1)).toMatchObject({ content: 'a5' })
  })

  it('degrades mechanically when the fork fails and the transcript is over the ceiling', async () => {
    aiMocks.streamText.mockImplementation(() => ({
      text: Promise.reject(new Error('provider down')),
      usage: Promise.resolve({})
    }))
    const deps = makeDeps()

    const result = await compactModelTranscript(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      transcript: longTranscript(),
      prompt: 'SUMMARIZE',
      policy: POLICY
    })

    expect(result).not.toBeNull()
    expect(result!.degraded).toBeDefined()
    expect(result!.transcript.length).toBeGreaterThan(0)
  })

  it('returns null when the fork fails but the transcript is still under the ceiling', async () => {
    aiMocks.streamText.mockImplementation(() => ({
      text: Promise.reject(new Error('provider down')),
      usage: Promise.resolve({})
    }))
    const deps = makeDeps()
    const small: ModelMessage[] = [
      { role: 'user', content: 'q'.repeat(3_000) },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'next' }
    ]

    const result = await compactModelTranscript(deps, {
      chatId: 'c1',
      def: DEF,
      cwd: '/tmp',
      runId: 'r1',
      transcript: small,
      prompt: 'SUMMARIZE',
      policy: POLICY
    })

    expect(result).toBeNull()
  })
})
