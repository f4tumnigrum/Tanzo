import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { AgentDefinition } from '@main/agent/agents/types'
import { TanzoOperationError } from '@shared/errors'
import { createAgentService } from '@main/agent/service'
import { createChatRunSessionRegistry } from '@main/agent/runtime/run-session-registry'

const mocks = vi.hoisted(() => {
  const buildPromptCacheDiagnostic = vi.fn((input: unknown) => ({ diagnostic: input }))
  const planCompaction = vi.fn()
  const buildCompactionResult = vi.fn()
  const runCompactionFork = vi.fn(async () => ({
    text: '<summary>summary</summary>',
    usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }
  }))
  const applyApprovalResponse = vi.fn()
  const extractPendingApprovals = vi.fn(() => [])
  const lastAssistantText = vi.fn(() => 'final answer')

  const convertToModelMessages = vi.fn(async (messages: unknown) => [{ converted: messages }])
  const streamResults: unknown[] = []
  const streamTextCalls: Record<string, unknown>[] = []
  const preparedSteps: unknown[] = []
  let beforePrepareStep: (() => void | Promise<void>) | undefined
  let afterPrepareStep: (() => void | Promise<void>) | undefined
  let failStream = false
  let failedFinishMessages: TanzoUIMessage[] = [{ id: 'empty-save', role: 'assistant', parts: [] }]
  let stepFinishReason = 'stop'
  let stepInputTokens = 5
  let prepareStepInputs: unknown[] = [{ stepNumber: 0, messages: [] }]
  let stepHasToolCall = true
  let maxTurns = 1
  const buildAgent = vi.fn()
  const streamText = vi.fn((options: Record<string, unknown>) => {
    buildAgent()
    streamTextCalls.push(options)
    const onStepEnd = options.onStepEnd as ((step: unknown) => void | Promise<void>) | undefined
    const prepareStep = options.prepareStep as
      ((input: Record<string, unknown>) => unknown | Promise<unknown>) | undefined
    const stopWhen = (options.stopWhen as Array<(input: { steps: unknown[] }) => unknown>) ?? []
    const recordedSteps: unknown[] = []
    const responseMessages: unknown[] = []
    let messagesForNextStep = options.messages as unknown[]

    const makeStep = (hasTool: boolean): Record<string, unknown> => ({
      usage: {
        inputTokens: stepInputTokens,
        outputTokens: 7,
        totalTokens: stepInputTokens + 7,
        inputTokenDetails: { cacheReadTokens: 2, cacheWriteTokens: 1 },
        outputTokenDetails: { reasoningTokens: 4 }
      },
      finishReason: stepFinishReason,
      providerMetadata: { provider: 'mock' },
      text: ' traced text ',
      toolCalls: hasTool
        ? [{ toolCallId: 'tool-1', toolName: 'shell', input: { command: 'pwd' } }]
        : [],
      toolResults: hasTool
        ? [
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              toolName: 'shell',
              input: { command: 'pwd' },
              output: { stdout: '/workspace' }
            }
          ]
        : []
    })

    const aborted = (): boolean =>
      Boolean((options.abortSignal as AbortSignal | undefined)?.aborted)

    const runSteps = async function* (): AsyncIterable<unknown> {
      let stepIndex = 0
      for (;;) {
        if (aborted()) return
        await beforePrepareStep?.()
        if (aborted()) return
        const prepared = await prepareStep?.({
          stepNumber: stepIndex,
          steps: [...recordedSteps],
          model: {},
          messages: messagesForNextStep,
          initialMessages: options.messages,
          responseMessages: [...responseMessages],
          toolsContext: {},
          runtimeContext: {}
        })
        const preparedMessages = (prepared as { messages?: unknown[] } | undefined)?.messages
        if (preparedMessages) messagesForNextStep = preparedMessages
        const hasTool = stepHasToolCall && stepIndex < maxTurns
        const step = makeStep(hasTool)
        await onStepEnd?.(step)
        await afterPrepareStep?.()
        recordedSteps.push(step)
        responseMessages.push({ role: 'assistant', content: `raw-step-${stepIndex}` })
        messagesForNextStep = [
          ...messagesForNextStep,
          responseMessages[responseMessages.length - 1]
        ]
        yield { type: 'text-delta', textDelta: 'hello' }
        stepIndex += 1
        if (!hasTool) return
        if (aborted()) return
        const stop = await Promise.all(stopWhen.map((c) => c({ steps: [...recordedSteps] })))
        if (stop.some(Boolean)) return
      }
    }

    const result = {
      stream: runSteps(),
      get steps() {
        return Promise.resolve(recordedSteps)
      },
      get response() {
        return Promise.resolve({ messages: responseMessages })
      },
      get usage() {
        return Promise.resolve(makeStep(false).usage)
      },
      get totalUsage() {
        return Promise.resolve(makeStep(false).usage)
      },
      get finishReason() {
        return Promise.resolve(stepFinishReason)
      }
    }
    streamResults.push(result)
    return result
  })

  const createUIMessageStream = vi.fn((config: Record<string, unknown>) =>
    (async function* () {
      const merged: AsyncIterable<unknown>[] = []
      const writer = {
        merge: vi.fn((s: AsyncIterable<unknown>) => {
          merged.push(s)
        })
      }
      await (config.execute as (input: { writer: typeof writer }) => Promise<void>)({ writer })
      if (failStream) {
        ;(config.onError as (error: unknown) => string)?.(new Error('bad api key'))
        await (config.onEnd as (input: unknown) => void | Promise<void>)?.({
          messages: failedFinishMessages
        })
        yield { type: 'error', errorText: 'bad api key' }
        return
      }
      const drained: unknown[] = []
      for (const s of merged) {
        for await (const chunk of s) drained.push(chunk)
      }
      await (config.onStepEnd as (input: unknown) => void | Promise<void>)?.({
        messages: [{ id: 'step-save', role: 'assistant', parts: [{ type: 'text', text: 'step' }] }]
      })
      for (const chunk of drained) yield chunk
      yield { type: 'data-status', id: 'status-1', data: { label: 'working' } }
      await (config.onEnd as (input: unknown) => void | Promise<void>)?.({
        messages: [
          { id: 'finish-save', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
        ]
      })
    })()
  )

  return {
    buildPromptCacheDiagnostic,
    planCompaction,
    buildCompactionResult,
    runCompactionFork,
    applyApprovalResponse,
    extractPendingApprovals,
    lastAssistantText,
    convertToModelMessages,
    createUIMessageStream,
    streamText,
    buildAgent,
    streamResults,
    streamTextCalls,
    preparedSteps,
    get stepHasToolCall() {
      return stepHasToolCall
    },
    set stepHasToolCall(value: boolean) {
      stepHasToolCall = value
    },
    get maxTurns() {
      return maxTurns
    },
    set maxTurns(value: number) {
      maxTurns = value
    },
    get prepareStepInputs() {
      return prepareStepInputs
    },
    set prepareStepInputs(value: unknown[]) {
      prepareStepInputs = value
    },
    get beforePrepareStep() {
      return beforePrepareStep
    },
    set beforePrepareStep(value: (() => void | Promise<void>) | undefined) {
      beforePrepareStep = value
    },
    get afterPrepareStep() {
      return afterPrepareStep
    },
    set afterPrepareStep(value: (() => void | Promise<void>) | undefined) {
      afterPrepareStep = value
    },
    get failStream() {
      return failStream
    },
    set failStream(value: boolean) {
      failStream = value
    },
    get failedFinishMessages() {
      return failedFinishMessages
    },
    set failedFinishMessages(value: TanzoUIMessage[]) {
      failedFinishMessages = value
    },
    get stepFinishReason() {
      return stepFinishReason
    },
    set stepFinishReason(value: string) {
      stepFinishReason = value
    },
    get stepInputTokens() {
      return stepInputTokens
    },
    set stepInputTokens(value: number) {
      stepInputTokens = value
    }
  }
})

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    convertToModelMessages: mocks.convertToModelMessages,
    createUIMessageStream: mocks.createUIMessageStream,
    streamText: mocks.streamText,
    toUIMessageStream: vi.fn((options: Record<string, unknown>) => {
      const { stream, messageMetadata } = options as {
        stream: AsyncIterable<unknown>
        messageMetadata?: (input: unknown) => unknown
      }
      return (async function* () {
        if (messageMetadata) {
          messageMetadata({
            part: {
              type: 'finish-step',
              usage: {
                inputTokens: mocks.stepInputTokens,
                outputTokens: 7,
                totalTokens: mocks.stepInputTokens + 7,
                inputTokenDetails: { cacheReadTokens: 2, cacheWriteTokens: 1 },
                outputTokenDetails: { reasoningTokens: 4 }
              },
              finishReason: mocks.stepFinishReason,
              providerMetadata: { provider: 'mock' }
            }
          })
          messageMetadata({ part: { type: 'text-delta' } })
          messageMetadata({
            part: {
              type: 'finish',
              totalUsage: {
                inputTokens: 9,
                outputTokens: 3,
                totalTokens: 12,
                cachedInputTokens: 1,
                reasoningTokens: 2
              }
            }
          })
        }
        for await (const chunk of stream) {
          yield chunk
        }
      })()
    })
  }
})

vi.mock('@ai-sdk/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ai-sdk/provider')>()
  return {
    ...actual,
    getErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    )
  }
})

vi.mock('@main/agent/context/compact/compact', () => ({
  planCompaction: mocks.planCompaction,
  buildCompactionResult: mocks.buildCompactionResult
}))

vi.mock('@main/agent/context/compact/fork-agent', () => ({
  runCompactionFork: mocks.runCompactionFork
}))

vi.mock('@main/agent/diagnostics/prompt-cache', () => ({
  buildPromptCacheDiagnostic: mocks.buildPromptCacheDiagnostic,
  stableStringify: vi.fn((value: unknown) => JSON.stringify(value))
}))

vi.mock('@main/agent/subagent/approval-utils', () => ({
  applyApprovalResponse: mocks.applyApprovalResponse,
  extractPendingApprovals: mocks.extractPendingApprovals,
  lastAssistantText: mocks.lastAssistantText
}))

const def: AgentDefinition = {
  id: 'main',
  name: 'Main',
  description: 'Main agent',
  kind: 'main',
  modelRef: 'openai:gpt',
  systemPrompt: 'System',
  allowedTools: null
}

const userMessage: TanzoUIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello' }]
}

function createDeps() {
  const conversations = new Map<string, Record<string, unknown>>([
    ['chat-1', { id: 'chat-1', cwd: '/workspace', agentId: 'main' }],
    ['empty', { id: 'empty', cwd: '/workspace', agentId: 'main' }],
    ['parent', { id: 'parent', cwd: '/workspace', workspaceId: 'ws', agentId: 'main' }],
    [
      'child-1',
      {
        id: 'child-1',
        cwd: '/workspace',
        workspaceId: 'ws',
        agentId: 'research',
        parentConversationId: 'parent',
        parentRelation: 'subagent'
      }
    ],
    [
      'fork-1',
      {
        id: 'fork-1',
        cwd: '/workspace',
        workspaceId: 'ws',
        agentId: 'main',
        parentConversationId: 'parent',
        parentRelation: 'fork'
      }
    ]
  ])
  const assistantHistory = (chatId: string): TanzoUIMessage[] => [
    {
      id: `${chatId}-assistant`,
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }]
    }
  ]
  const savedMessages = new Map<string, TanzoUIMessage[]>([
    ['chat-1', assistantHistory('chat-1')],
    ['parent', assistantHistory('parent')],
    ['child-1', assistantHistory('child-1')],
    ['fork-1', assistantHistory('fork-1')]
  ])
  const cloneMessages = (messages: TanzoUIMessage[]): TanzoUIMessage[] => structuredClone(messages)
  const store = {
    transaction: vi.fn(<T>(fn: () => T) => fn()),
    resolveAgentDefinition: vi.fn(async () => def),
    depthOf: vi.fn((chatId: string) => (chatId === 'child-1' ? 1 : 0)),
    rootOf: vi.fn((chatId: string) => (chatId === 'child-1' ? 'parent' : chatId)),
    getConversation: vi.fn((chatId: string) => conversations.get(chatId)),
    listChildren: vi.fn((chatId: string) => (chatId === 'parent' ? [{ id: 'child-1' }] : [])),
    createConversation: vi.fn((input: Record<string, unknown>) => {
      conversations.set('child-1', { id: 'child-1', ...input, agentId: input.agentId ?? 'main' })
      return conversations.get('child-1')
    }),
    save: vi.fn((chatId: string, messages: TanzoUIMessage[]) => {
      savedMessages.set(chatId, cloneMessages(messages))
    }),
    load: vi.fn(async (chatId: string) => cloneMessages(savedMessages.get(chatId) ?? [])),
    loadUnvalidated: vi.fn((chatId: string) => cloneMessages(savedMessages.get(chatId) ?? [])),
    finalizeCompaction: vi.fn(
      (chatId: string, _archivedIds: string[], _summaryId: string, next: TanzoUIMessage[]) => {
        savedMessages.set(chatId, cloneMessages(next))
      }
    ),
    markRunOutcome: vi.fn(),
    listAllQueuedMessages: vi.fn(() => [] as Array<{ chatId: string; items: string[] }>),
    saveQueuedMessages: vi.fn(),
    tasks: (() => {
      const rows = new Map<string, Record<string, unknown>>()
      return {
        insert: vi.fn((task: { id: string }) => rows.set(task.id, { ...task })),
        update: vi.fn((task: { id: string }) => rows.set(task.id, { ...task })),
        get: vi.fn((_root: string, id: string) => rows.get(id)),
        getByChat: vi.fn((chatId: string) =>
          [...rows.values()].find((t) => (t as { chatId?: string }).chatId === chatId)
        ),
        listByRoot: vi.fn((root: string) =>
          [...rows.values()].filter((t) => (t as { rootChatId?: string }).rootChatId === root)
        ),
        listUnsettled: vi.fn(() =>
          [...rows.values()].filter((t) =>
            ['pending', 'running', 'blocked'].includes((t as { status?: string }).status ?? '')
          )
        ),
        nextSeq: vi.fn(() => rows.size + 1),
        countByAgent: vi.fn(
          (root: string, agentType: string) =>
            [...rows.values()].filter(
              (t) =>
                (t as { rootChatId?: string }).rootChatId === root &&
                (t as { agentType?: string }).agentType === agentType
            ).length
        )
      }
    })(),
    getLatestPromptDiagnostic: vi.fn(() => ({ previous: true })),
    recordPromptDiagnostic: vi.fn(),
    finishPromptDiagnostic: vi.fn()
  }
  const contextEngine = {
    prepareStep: vi.fn(() =>
      vi.fn(async () => ({
        system: 'prepared system',
        messages: [{ role: 'user', content: 'prepared' }],
        providerOptions: { cache: true }
      }))
    ),
    build: vi.fn(async () => {
      const prepared = {
        instructions: 'prepared system',
        messages: [{ role: 'user', content: 'prepared' }],
        providerOptions: { cache: true }
      }
      mocks.preparedSteps.push(prepared)
      return prepared
    }),
    observeStep: vi.fn(),
    snapshot: vi.fn(() => ({
      usedTokens: 42,
      windowTokens: 100,
      compactionTriggerTokens: 90,
      compactionTriggered: false,
      source: 'reported',
      cacheKind: 'auto',
      serverCompaction: false
    })),
    shouldCompact: vi.fn(() => false),
    compactionTriggerTokens: vi.fn(() => 100000),
    retainedRecentSteps: vi.fn(() => 6),
    clear: vi.fn()
  }
  const goal = {
    get: vi.fn(() => null),
    evaluate: vi.fn(() => ({ continue: false })),
    markUsageLimited: vi.fn()
  }

  const streams = createChatRunSessionRegistry()

  return {
    providerService: {
      resolveLanguageModel: vi.fn(() => ({ model: 'language' })),
      getCallSettings: vi.fn(() => ({ temperature: 0.2, unknown: true })),
      getProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: 'high' } }))
    },
    buildTools: vi.fn(async () => ({
      shell: { metadata: { tanzo: { kind: 'exec' } } }
    })),
    policy: {
      getMode: vi.fn(() => 'default'),
      decide: vi.fn(),
      remember: vi.fn()
    },
    store,
    identity: {
      resolveAgentType: vi.fn(() => ({ id: 'research' })),
      listAgents: vi.fn(),
      listAgentTypes: vi.fn()
    },
    send: vi.fn(),
    skills: { list: vi.fn(() => []), get: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn() },
    contextEngine,
    goal,
    streams
  }
}

describe('agent/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.streamResults.length = 0
    mocks.preparedSteps.length = 0
    mocks.prepareStepInputs = [{ stepNumber: 0, messages: [] }]
    mocks.beforePrepareStep = undefined
    mocks.afterPrepareStep = undefined
    mocks.failStream = false
    mocks.failedFinishMessages = [{ id: 'empty-save', role: 'assistant', parts: [] }]
    mocks.stepFinishReason = 'stop'
    mocks.stepInputTokens = 5
    mocks.streamTextCalls.length = 0
    mocks.stepHasToolCall = true
    mocks.maxTurns = 1
  })

  it('runs PostToolUse hooks for completed tool results', async () => {
    const deps = createDeps()
    const runPostToolUse = vi.fn(async () => ({ stopped: false }))
    ;(deps as typeof deps & { hooks: unknown }).hooks = {
      runUserPromptSubmit: vi.fn(async () => ({ denied: false })),
      runSessionStart: vi.fn(async () => undefined),
      runPostToolUse,
      runStop: vi.fn(async () => ({ stopped: false, feedback: [] }))
    }
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(runPostToolUse).toHaveBeenCalledWith({
      chatId: 'chat-1',
      toolName: 'shell',
      toolInput: { command: 'pwd' },
      toolResponse: { stdout: '/workspace' },
      toolUseId: 'tool-1'
    })
  })

  it('rebuilds each turn from a clean transcript without accumulating injected context', async () => {
    const deps = createDeps()
    const seenTranscripts: unknown[] = []
    deps.contextEngine.build.mockImplementation(
      async (_def: unknown, _chatId: unknown, _cwd: unknown, transcript: unknown[]) => {
        seenTranscripts.push(transcript)
        return {
          instructions: 'role + tools',
          messages: [{ role: 'user', content: 'INJECTED-CONTEXT' }, ...transcript],
          providerOptions: { cache: true }
        }
      }
    )
    mocks.maxTurns = 1
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(seenTranscripts.length).toBeGreaterThanOrEqual(2)
    for (const transcript of seenTranscripts) {
      const leaked = (transcript as { content?: unknown }[]).some(
        (m) => (m as { content?: unknown }).content === 'INJECTED-CONTEXT'
      )
      expect(leaked).toBe(false)
    }
  })
  it('continues once when a Stop hook requests more work', async () => {
    const deps = createDeps()
    const runStop = vi
      .fn()
      .mockResolvedValueOnce({ stopped: true, stopReason: 'continue', feedback: [] })
      .mockResolvedValueOnce({ stopped: false, feedback: [] })
    ;(deps as typeof deps & { hooks: unknown }).hooks = {
      runUserPromptSubmit: vi.fn(async () => ({ denied: false })),
      runSessionStart: vi.fn(async () => undefined),
      runPostToolUse: vi.fn(async () => ({ stopped: false })),
      runStop
    }
    mocks.stepHasToolCall = false
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(mocks.buildAgent).toHaveBeenCalledTimes(2)
    expect(runStop).toHaveBeenNthCalledWith(1, {
      chatId: 'chat-1',
      stopHookActive: false,
      lastAssistantMessage: 'done'
    })
    expect(runStop).toHaveBeenNthCalledWith(2, {
      chatId: 'chat-1',
      stopHookActive: true,
      lastAssistantMessage: 'done'
    })
  })

  it('runs a conversation stream, records diagnostics, broadcasts chunks, and compacts', async () => {
    const deps = createDeps()
    mocks.planCompaction.mockResolvedValue({
      head: [{ id: 'old-1', role: 'user', parts: [] }],
      tail: [userMessage],
      archivedIds: ['old-1'],
      beforeTokens: 1000,
      sourceMessages: [{ role: 'user', content: 'old transcript' }]
    })
    let streamedSummaryId: string | null = null
    mocks.runCompactionFork.mockImplementationOnce(
      async (_runtimeDeps: unknown, input: { onSummary?: (summary: string) => void }) => {
        input.onSummary?.('Primary request and intent — partial')
        return {
          text: '<summary>summary</summary>',
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }
        }
      }
    )
    mocks.buildCompactionResult.mockImplementation(({ summaryId }: { summaryId?: string }) => {
      streamedSummaryId = summaryId ?? null
      return {
        summary: {
          id: summaryId ?? 'summary',
          role: 'user',
          parts: [
            { type: 'text', text: 'summary' },
            {
              type: 'data-compaction',
              data: { stage: 'complete', summary: 'summary', summaryId: summaryId ?? 'summary' }
            }
          ]
        },
        archivedIds: ['old-1'],
        next: [userMessage],
        beforeTokens: 1000,
        afterTokens: 100
      }
    })
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(deps.store.resolveAgentDefinition).toHaveBeenCalledWith('chat-1')
    expect(deps.buildTools).toHaveBeenCalledWith({
      def,
      chatId: 'chat-1',
      depth: 0,
      mode: 'default',
      messages: [userMessage]
    })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: { shell: { metadata: { tanzo: { kind: 'exec' } } } },
        runtimeContext: { chatId: 'chat-1', mode: 'default' },
        prepareStep: expect.any(Function),
        stopWhen: expect.any(Array),
        telemetry: expect.objectContaining({
          isEnabled: true,
          integrations: expect.any(Array)
        })
      })
    )
    expect(mocks.preparedSteps.at(-1)).toMatchObject({ instructions: 'prepared system' })
    expect(deps.store.recordPromptDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ diagnostic: expect.objectContaining({ conversationId: 'chat-1' }) })
    )
    expect(deps.store.finishPromptDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'chat-1',
        stepNumber: 1,
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
        cacheReadTokens: 2,
        cacheWriteTokens: 1
      })
    )
    expect(deps.contextEngine.observeStep).toHaveBeenCalledWith('chat-1', 2, expect.any(Object))
    await vi.waitFor(() =>
      expect(deps.send).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({
          type: 'data-context',
          id: 'context:chat-1',
          data: expect.objectContaining({ usedTokens: 42 }),
          transient: true
        }),
        expect.objectContaining({ runId: expect.any(String) })
      )
    )
    expect(deps.store.save).toHaveBeenCalledWith('chat-1', [
      userMessage,
      { id: 'step-save', role: 'assistant', parts: [{ type: 'text', text: 'step' }] }
    ])
    expect(deps.store.save).toHaveBeenCalledWith('chat-1', [
      userMessage,
      { id: 'step-save', role: 'assistant', parts: [{ type: 'text', text: 'step' }] },
      { id: 'finish-save', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    ])
    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      {
        type: 'data-status',
        id: 'status-1',
        data: { label: 'working' }
      },
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(service.isRunning('chat-1')).toBe(false)

    const compactOutcome = await service.compact('chat-1')
    expect(compactOutcome).toBe('compacted')
    expect(mocks.planCompaction).toHaveBeenCalledWith(expect.any(Array), 6)
    expect(mocks.runCompactionFork).toHaveBeenCalledWith(
      expect.objectContaining({ contextEngine: deps.contextEngine }),
      expect.objectContaining({
        chatId: 'chat-1',
        def,
        cwd: '/workspace',
        head: [{ role: 'user', content: 'old transcript' }],
        prompt: expect.stringContaining('You are compacting a long engineering conversation')
      })
    )
    expect(mocks.buildCompactionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryText: '<summary>summary</summary>',
        auto: false,
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        summaryId: expect.any(String)
      })
    )
    expect(streamedSummaryId).toEqual(expect.any(String))
    expect(deps.store.finalizeCompaction).toHaveBeenCalledWith(
      'chat-1',
      ['old-1'],
      streamedSummaryId,
      [userMessage],
      ['user-1', 'step-save', 'finish-save']
    )
    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-compaction',
        id: `compaction:${streamedSummaryId}`,
        data: expect.objectContaining({
          stage: 'start',
          summaryId: streamedSummaryId,
          summary: 'Primary request and intent — partial'
        }),
        transient: true
      }),
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-compaction',
        id: `compaction:${streamedSummaryId}`,
        transient: true
      }),
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-context',
        id: 'context:chat-1',
        data: expect.objectContaining({ usedTokens: 42 }),
        transient: true
      }),
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(deps.contextEngine.clear).toHaveBeenCalledWith('chat-1')
    expect(deps.logger.info).toHaveBeenCalledWith('compacted conversation', {
      chatId: 'chat-1',
      beforeTokens: 1000,
      afterTokens: 100
    })
  })

  it('throws automatic compaction failures instead of continuing with original messages', async () => {
    const deps = createDeps()
    deps.contextEngine.shouldCompact.mockReturnValue(true)
    mocks.planCompaction.mockResolvedValue({
      head: [{ id: 'old-1', role: 'user', parts: [] }],
      tail: [userMessage],
      archivedIds: ['old-1'],
      beforeTokens: 1000,
      sourceMessages: [{ role: 'user', content: 'old transcript' }]
    })
    mocks.runCompactionFork.mockRejectedValueOnce(new Error('provider returned html'))
    const service = createAgentService(deps as never)

    await expect(service.run('chat-1', [userMessage])).rejects.toThrow('provider returned html')

    expect(deps.contextEngine.shouldCompact).toHaveBeenCalledWith(def, 'chat-1', expect.any(Array))
    expect(mocks.planCompaction).toHaveBeenCalledWith(expect.any(Array), 6)
    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-compaction',
        data: expect.objectContaining({
          stage: 'failed',
          auto: true,
          summary: 'provider returned html'
        }),
        transient: true
      }),
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(mocks.buildAgent).not.toHaveBeenCalled()
  })

  it('drains consumed steering into a later turn transcript and persists it after the run', async () => {
    const deps = createDeps()
    const seenTranscripts: unknown[][] = []
    let buildCount = 0
    deps.contextEngine.build.mockImplementation(
      async (_def: unknown, _chatId: unknown, _cwd: unknown, transcript: unknown[]) => {
        seenTranscripts.push(transcript)
        if (buildCount === 0) service.steer('chat-1', 'run the tests first')
        buildCount += 1
        return {
          instructions: 'prepared system',
          messages: [{ role: 'user', content: 'prepared' }, ...transcript],
          providerOptions: { cache: true }
        }
      }
    )
    const service = createAgentService(deps as never)
    mocks.maxTurns = 1

    await service.run('chat-1', [userMessage])

    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-steering',
        data: { text: 'run the tests first' },
        transient: true
      })
    )
    const folded = seenTranscripts.some((transcript) =>
      transcript.some((m) => (m as { content?: unknown }).content === 'run the tests first')
    )
    expect(folded).toBe(true)
    expect(deps.store.save).toHaveBeenCalledWith('chat-1', [
      userMessage,
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', text: 'run the tests first' }]
      }),
      { id: 'step-save', role: 'assistant', parts: [{ type: 'text', text: 'step' }] },
      { id: 'finish-save', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    ])
  })

  it('does not echo idle steering and carries late steering forward as a queued message', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    service.steer('chat-1', 'idle steer')
    expect(deps.send).not.toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ type: 'data-steering' })
    )

    mocks.afterPrepareStep = () => {
      service.steer('chat-1', 'too late for this run')
      mocks.afterPrepareStep = undefined
    }
    await service.run('chat-1', [userMessage])

    expect(
      mocks.preparedSteps.every(
        (step) =>
          !(step?.messages as Array<{ content?: unknown }> | undefined)?.some(
            (m) => m.content === 'too late for this run'
          )
      )
    ).toBe(true)
    expect(deps.store.save).not.toHaveBeenCalledWith(
      'chat-1',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          parts: [{ type: 'text', text: 'too late for this run' }]
        })
      ])
    )
  })

  it('queues id-shaped messages while inflight, removes by id, and persists text only', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    let snapshotDuringRun: ReturnType<typeof service.listQueued> = []
    let armed = true
    mocks.beforePrepareStep = () => {
      if (!armed) return
      armed = false
      service.enqueue('chat-1', 'first')
      service.enqueue('chat-1', 'second')
      const items = service.listQueued('chat-1')
      expect(items).toEqual([
        { id: expect.any(String), text: 'first' },
        { id: expect.any(String), text: 'second' }
      ])
      expect(deps.send).toHaveBeenLastCalledWith(
        'chat-1',
        expect.objectContaining({ type: 'data-queued', data: { items }, transient: true })
      )
      service.removeQueued('chat-1', items[0].id)
      snapshotDuringRun = service.listQueued('chat-1')
    }

    await service.run('chat-1', [userMessage])

    expect(snapshotDuringRun).toEqual([{ id: expect.any(String), text: 'second' }])
    // The durable store keeps only ordered text; ids are transient UI handles.
    expect(deps.store.saveQueuedMessages).toHaveBeenCalledWith('chat-1', ['second'])
  })

  it('restores queued messages from the store as id-shaped items', () => {
    const deps = createDeps()
    deps.store.listAllQueuedMessages.mockReturnValue([{ chatId: 'chat-1', items: ['restored'] }])
    const service = createAgentService(deps as never)

    expect(service.listQueued('chat-1')).toEqual([{ id: expect.any(String), text: 'restored' }])
  })

  it('dispatches an idle enqueue immediately instead of leaving it stuck', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    service.enqueue('chat-1', 'send now')

    await vi.waitFor(() =>
      expect(deps.store.save).toHaveBeenCalledWith(
        'chat-1',
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            parts: [{ type: 'text', text: 'send now' }]
          })
        ])
      )
    )
    expect(service.listQueued('chat-1')).toEqual([])
  })

  it('dispatches the next queued message as a new turn after the current turn ends', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    service.enqueue('chat-1', 'queued prompt')
    await service.run('chat-1', [userMessage])

    await vi.waitFor(() =>
      expect(deps.store.save).toHaveBeenCalledWith(
        'chat-1',
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            parts: [{ type: 'text', text: 'queued prompt' }]
          })
        ])
      )
    )
    expect(service.listQueued('chat-1')).toEqual([])
  })

  it('accounts goal usage before dispatching a queued message', async () => {
    const deps = createDeps()
    deps.goal.get.mockReturnValue({
      chatId: 'chat-1',
      objective: 'Ship it',
      userState: 'active',
      outcome: null,
      limit: null,
      tokenBudget: null,
      tokensUsed: 0,
      timeBudgetSeconds: null,
      timeUsedSeconds: 0,
      idleStreak: 0,
      blockerStreak: 0,
      pendingInjection: null,
      createdAt: 1,
      updatedAt: 1
    })
    const service = createAgentService(deps as never)

    let armed = true
    mocks.beforePrepareStep = () => {
      if (!armed) return
      armed = false
      service.enqueue('chat-1', 'queued prompt')
    }
    await service.run('chat-1', [userMessage])

    expect(deps.goal.evaluate).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        isGoalContinuation: false,
        producedWorkToolCall: true,
        turnTokens: 12,
        isPlanMode: false,
        suppressContinuation: true
      })
    )
    await vi.waitFor(() =>
      expect(deps.store.save).toHaveBeenCalledWith(
        'chat-1',
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            parts: [{ type: 'text', text: 'queued prompt' }]
          })
        ])
      )
    )
  })

  it('drops a queued goal continuation when the user cancels before it starts', async () => {
    const deps = createDeps()
    deps.goal.get.mockReturnValue({
      chatId: 'chat-1',
      objective: 'Ship it',
      userState: 'active',
      outcome: null,
      limit: null,
      tokenBudget: null,
      tokensUsed: 0,
      timeBudgetSeconds: null,
      timeUsedSeconds: 0,
      idleStreak: 0,
      blockerStreak: 0,
      pendingInjection: null,
      createdAt: 1,
      updatedAt: 1
    })
    let armed = true
    deps.goal.evaluate.mockImplementation(() => {
      if (!armed) return { continue: false }
      armed = false
      service.cancel('chat-1')
      return { continue: true }
    })
    mocks.stepHasToolCall = false
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])
    await service.settleRuns(1000)

    expect(mocks.buildAgent).toHaveBeenCalledTimes(1)
  })

  it('keeps queued messages across an aborted turn without dispatching them', async () => {
    const deps = createDeps()
    deps.goal.get.mockReturnValue({
      chatId: 'chat-1',
      objective: 'Ship it',
      userState: 'active',
      outcome: null,
      limit: null,
      tokenBudget: null,
      tokensUsed: 0,
      timeBudgetSeconds: null,
      timeUsedSeconds: 0,
      idleStreak: 0,
      blockerStreak: 0,
      pendingInjection: null,
      createdAt: 1,
      updatedAt: 1
    })
    const service = createAgentService(deps as never)
    let armed = true
    mocks.beforePrepareStep = () => {
      if (!armed) return
      armed = false
      service.enqueue('chat-1', 'survives abort')
      service.cancel('chat-1')
    }

    await service.run('chat-1', [userMessage])

    expect(service.listQueued('chat-1')).toEqual([
      { id: expect.any(String), text: 'survives abort' }
    ])
    expect(deps.store.save).not.toHaveBeenCalledWith(
      'chat-1',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', text: 'survives abort' }]
        })
      ])
    )
    expect(deps.goal.evaluate).not.toHaveBeenCalled()
  })

  it('does not auto-continue an aborted tool-call turn', async () => {
    const deps = createDeps()
    deps.contextEngine.compactionTriggerTokens.mockReturnValue(1)
    mocks.stepFinishReason = 'tool-calls'
    mocks.stepInputTokens = 100
    const service = createAgentService(deps as never)
    let armed = true
    mocks.beforePrepareStep = () => {
      if (!armed) return
      armed = false
      service.cancel('chat-1')
    }

    await service.run('chat-1', [userMessage])

    expect(mocks.buildAgent).toHaveBeenCalledTimes(1)
    expect(deps.store.load).not.toHaveBeenCalledWith('chat-1')
  })

  it('auto-compacts after a normal turn exceeds the compaction trigger without starting another model pass', async () => {
    const deps = createDeps()
    deps.contextEngine.compactionTriggerTokens.mockReturnValue(1)
    mocks.stepFinishReason = 'stop'
    mocks.stepInputTokens = 100
    mocks.stepHasToolCall = false
    const summary = {
      id: 'summary',
      role: 'user',
      parts: [
        { type: 'text', text: 'summary' },
        {
          type: 'data-compaction',
          data: { stage: 'complete', summary: 'summary', summaryId: 'summary' }
        }
      ]
    }
    mocks.planCompaction.mockResolvedValue({
      head: [{ id: 'old-1', role: 'user', parts: [] }],
      tail: [userMessage],
      archivedIds: ['old-1'],
      beforeTokens: 1000,
      sourceMessages: [{ role: 'user', content: 'old transcript' }]
    })
    mocks.buildCompactionResult.mockReturnValue({
      summary,
      archivedIds: ['old-1'],
      next: [userMessage],
      beforeTokens: 1000,
      afterTokens: 100
    })
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(mocks.buildAgent).toHaveBeenCalledTimes(1)
    expect(mocks.planCompaction).toHaveBeenCalledWith(expect.any(Array), 6)
    expect(mocks.buildCompactionResult).toHaveBeenCalledWith(
      expect.objectContaining({ auto: true, summaryText: '<summary>summary</summary>' })
    )
    expect(deps.store.finalizeCompaction).toHaveBeenCalledWith(
      'chat-1',
      ['old-1'],
      'summary',
      [userMessage],
      ['user-1', 'step-save', 'finish-save']
    )
  })

  it('does not persist an empty response message when the provider stream fails', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    mocks.failStream = true

    await service.run('chat-1', [userMessage])

    expect(deps.logger.warn).toHaveBeenCalledWith('chat stream failed', {
      chatId: 'chat-1',
      error: { kind: 'unknown', message: 'bad api key', name: 'Error' }
    })
    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-telemetry',
        data: expect.objectContaining({
          event: 'operation-error',
          error: { kind: 'unknown', message: 'bad api key', name: 'Error' }
        }),
        transient: true
      }),
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(deps.store.save).toHaveBeenCalledWith('chat-1', [userMessage])
    expect(deps.store.save).not.toHaveBeenCalledWith('chat-1', [
      { id: 'empty-save', role: 'assistant', parts: [] }
    ])
  })

  it('persists partial response messages when the provider stream fails after producing output', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    mocks.failStream = true
    mocks.failedFinishMessages = [
      {
        id: 'partial-save',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial answer before failure' }]
      }
    ]

    await service.run('chat-1', [userMessage])

    expect(deps.store.save).toHaveBeenCalledWith('chat-1', [
      userMessage,
      {
        id: 'partial-save',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial answer before failure' }]
      }
    ])
    expect(deps.contextEngine.snapshot).not.toHaveBeenCalled()
  })

  it('sends user messages and cancels the task tree without error', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    await service.submitUserMessage('chat-1', 'new prompt')
    expect(deps.store.save).toHaveBeenCalledWith(
      'chat-1',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', text: 'new prompt' }]
        })
      ])
    )

    expect(() => service.cancel('parent')).not.toThrow()
  })

  it('submits a structured user message and persists it with the run', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    const message = {
      id: 'u-files',
      role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,xyz' },
        { type: 'text', text: 'what is in this image?' }
      ]
    } as TanzoUIMessage

    await service.submitMessage('chat-1', message)

    expect(deps.store.save).toHaveBeenCalledWith('chat-1', expect.arrayContaining([message]))
  })

  it('runs fork conversation messages as independent chat runs', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    const message = {
      id: 'fork-user',
      role: 'user',
      parts: [{ type: 'text', text: 'continue this branch' }]
    } as TanzoUIMessage

    await service.submitMessage('fork-1', message)

    expect(deps.buildTools).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'fork-1' }))
    expect(deps.store.save).toHaveBeenCalledWith('fork-1', expect.arrayContaining([message]))
    expect(deps.store.save.mock.calls.map(([chatId]) => chatId)).not.toContain('parent')
  })

  it('edits the latest user message in place and reruns from it', async () => {
    const deps = createDeps()
    const history = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'original' }] }
    ] as TanzoUIMessage[]
    deps.store.save('chat-1', history)
    const service = createAgentService(deps as never)

    await service.editMessage('chat-1', 'u2', 'edited prompt')

    expect(deps.store.save).toHaveBeenCalledWith('chat-1', [
      history[0],
      history[1],
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'edited prompt' }] }
    ])
  })

  it('rejects editing a message that is not the latest', async () => {
    const deps = createDeps()
    const history = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] }
    ] as TanzoUIMessage[]
    deps.store.save('chat-1', history)
    const service = createAgentService(deps as never)

    await expect(service.editMessage('chat-1', 'u1', 'changed')).rejects.toThrow()
  })

  it('applies approval responses to stored history, remembers scoped decisions, and reruns', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    const approvalHistory = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'edit it' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.ts', oldText: 'a', newText: 'b' },
            approval: { id: 'approval-7' }
          }
        ]
      }
    ] as TanzoUIMessage[]
    deps.store.save('chat-1', approvalHistory)

    await service.respondApprovals('chat-1', [
      { approvalId: 'approval-7', approved: true, scope: 'forever' }
    ])

    expect(deps.policy.remember).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'fileEdit', decision: 'approved', scope: 'forever' }),
      'chat-1'
    )
    expect(deps.store.save).toHaveBeenCalledWith(
      'chat-1',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'a1',
          parts: [
            expect.objectContaining({
              state: 'approval-responded',
              approval: { id: 'approval-7', approved: true }
            })
          ]
        })
      ])
    )

    deps.policy.remember.mockClear()
    mocks.buildAgent.mockClear()
    await service.respondApprovals('chat-1', [{ approvalId: 'missing', approved: true }])
    expect(deps.policy.remember).not.toHaveBeenCalled()
    expect(mocks.buildAgent).not.toHaveBeenCalled()
  })

  it('defers the rerun until every concurrent approval in the turn is resolved', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    const approvalHistory = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'do both' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.ts', oldText: 'a', newText: 'b' },
            approval: { id: 'approval-1' }
          },
          {
            type: 'tool-shell',
            toolCallId: 'call-2',
            state: 'approval-requested',
            input: { command: 'ls' },
            approval: { id: 'approval-2' }
          }
        ]
      }
    ] as TanzoUIMessage[]
    deps.store.save('chat-1', approvalHistory)

    mocks.buildAgent.mockClear()

    // Answering only the first approval persists the decision but must NOT rerun
    // the turn — the second approval is still pending.
    const first = await service.respondApprovals('chat-1', [
      { approvalId: 'approval-1', approved: true }
    ])
    expect(first).toEqual({ started: false })
    expect(mocks.buildAgent).not.toHaveBeenCalled()

    // Resolving the last pending approval triggers a single rerun.
    const second = await service.respondApprovals('chat-1', [
      { approvalId: 'approval-2', approved: true }
    ])
    expect(second).toEqual({ started: true })
    expect(mocks.buildAgent).toHaveBeenCalledTimes(1)
  })

  it('batch-resolves concurrent approvals in one rerun', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    const approvalHistory = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'do both' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.ts', oldText: 'a', newText: 'b' },
            approval: { id: 'approval-1' }
          },
          {
            type: 'tool-shell',
            toolCallId: 'call-2',
            state: 'approval-requested',
            input: { command: 'ls' },
            approval: { id: 'approval-2' }
          }
        ]
      }
    ] as TanzoUIMessage[]
    deps.store.save('chat-1', approvalHistory)

    mocks.buildAgent.mockClear()

    const result = await service.respondApprovals('chat-1', [
      { approvalId: 'approval-1', approved: true },
      { approvalId: 'approval-2', approved: false }
    ])
    expect(result).toEqual({ started: true })
    expect(mocks.buildAgent).toHaveBeenCalledTimes(1)
  })

  it('persists a follow-up message to a sub-agent conversation without re-running the inbox', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    service.cancel('child-1')
    await service.submitUserMessage('child-1', 'resume after stop')

    expect(deps.store.save).toHaveBeenCalledWith(
      'child-1',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', text: 'resume after stop' }]
        })
      ])
    )
  })

  it('spawns a task and resolves its result through await (pull model)', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    const task = service.spawnTask({
      parentChatId: 'parent',
      objective: 'research this',
      agentType: 'research'
    })
    expect(task.id).toBe('research-1')
    expect(deps.identity.resolveAgentType).toHaveBeenCalledWith('research')
    expect(deps.store.createConversation).toHaveBeenCalledWith({
      agentId: 'research',
      workspaceId: 'ws',
      cwd: '/workspace',
      parentConversationId: 'parent',
      parentRelation: 'subagent'
    })
    expect(deps.store.save).toHaveBeenCalledWith('child-1', [
      expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'research this' }] })
    ])

    const result = await service.awaitTask('parent', 'research-1')
    expect(result.summary).toBe('final answer')
    const settled = service.getTask('parent', 'research-1')
    expect(settled?.status).toBe('done')
  })

  it('does not start a dependent task until its dependency completes', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    const first = service.spawnTask({
      parentChatId: 'parent',
      objective: 'first',
      agentType: 'research'
    })
    const second = service.spawnTask({
      parentChatId: 'parent',
      objective: 'second',
      agentType: 'research',
      dependsOn: [first.id]
    })
    expect(service.getTask('parent', second.id)?.status).toBe('pending')
    expect(service.getTask('parent', second.id)?.block?.kind).toBe('dependency')
  })

  it('fails a dependent task when its dependency fails to start', async () => {
    const deps = createDeps()
    deps.store.resolveAgentDefinition.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const service = createAgentService(deps as never)

    const first = service.spawnTask({
      parentChatId: 'parent',
      objective: 'first',
      agentType: 'research'
    })
    const second = service.spawnTask({
      parentChatId: 'parent',
      objective: 'second',
      agentType: 'research',
      dependsOn: [first.id]
    })

    const result = await service.awaitTask('parent', second.id)
    expect(result.failed).toBe(true)
    expect(service.getTask('parent', second.id)?.status).toBe('failed')
  })

  it('seeds an empty conversation with the objective when starting a goal continuation', async () => {
    const deps = createDeps()
    deps.goal.get.mockReturnValue({
      chatId: 'empty',
      objective: 'Implement login',
      userState: 'active',
      outcome: null,
      limit: null,
      tokenBudget: null,
      tokensUsed: 0,
      timeBudgetSeconds: null,
      timeUsedSeconds: 0,
      idleStreak: 0,
      blockerStreak: 0,
      pendingInjection: 'continuation',
      createdAt: 1,
      updatedAt: 1
    })
    const service = createAgentService(deps as never)

    await service.startGoalContinuation('empty')

    expect(deps.store.save).toHaveBeenCalledWith(
      'empty',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', text: 'Implement login' }]
        })
      ])
    )
  })

  it('does not start a goal continuation when no goal exists', async () => {
    const deps = createDeps()
    deps.goal.get.mockReturnValue(null)
    const service = createAgentService(deps as never)

    await service.startGoalContinuation('empty')

    expect(deps.store.save).not.toHaveBeenCalled()
  })

  it('skips compaction and keeps the run alive when finalize detects concurrent changes', async () => {
    const deps = createDeps()
    deps.contextEngine.shouldCompact.mockReturnValue(true)
    mocks.planCompaction.mockResolvedValue({
      head: [{ id: 'old-1', role: 'user', parts: [] }],
      tail: [userMessage],
      archivedIds: ['old-1'],
      beforeTokens: 1000,
      sourceMessages: [{ role: 'user', content: 'old transcript' }]
    })
    mocks.buildCompactionResult.mockReturnValue({
      summary: { id: 'summary-1', role: 'user', parts: [{ type: 'text', text: 'summary' }] },
      archivedIds: ['old-1'],
      next: [userMessage]
    })
    deps.store.finalizeCompaction.mockImplementation(() => {
      throw new TanzoOperationError('CHAT_COMPACTION_STALE', 'stale')
    })
    const service = createAgentService(deps as never)

    await expect(service.run('chat-1', [userMessage])).resolves.toBeUndefined()

    expect(deps.send).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        type: 'data-compaction',
        data: expect.objectContaining({ stage: 'failed' }),
        transient: true
      }),
      expect.objectContaining({ runId: expect.any(String) })
    )
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'compaction skipped: conversation changed while compacting',
      { chatId: 'chat-1' }
    )
    expect(deps.store.save).toHaveBeenCalledWith(
      'chat-1',
      expect.arrayContaining([expect.objectContaining({ id: 'finish-save' })])
    )
  })

  it('runs compaction through the run lifecycle so it is visible in listRunning and abortable', async () => {
    const deps = createDeps()
    mocks.planCompaction.mockResolvedValue({
      head: [{ id: 'old-1', role: 'user', parts: [] }],
      tail: [userMessage],
      archivedIds: ['old-1'],
      beforeTokens: 1000,
      sourceMessages: [{ role: 'user', content: 'old transcript' }]
    })
    let releaseFork!: () => void
    const forkStarted = new Promise<void>((resolveStarted) => {
      mocks.runCompactionFork.mockImplementationOnce(async () => {
        resolveStarted()
        await new Promise<void>((resolve) => {
          releaseFork = resolve
        })
        return { text: '<summary>summary</summary>' }
      })
    })
    const service = createAgentService(deps as never)

    const compacting = service.compact('chat-1')
    await forkStarted

    expect(service.listRunning()).toContain('chat-1')
    expect(service.isRunning('chat-1')).toBe(true)

    service.cancel('chat-1')
    releaseFork()
    const abortedOutcome = await compacting

    expect(abortedOutcome).toBe('aborted')
    expect(deps.store.finalizeCompaction).not.toHaveBeenCalled()
  })

  it('settleRuns waits for in-flight streams and reports timeouts', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    await expect(service.settleRuns(50)).resolves.toBe(true)

    let release!: () => void
    mocks.beforePrepareStep = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    const running = service.run('chat-1', [userMessage])
    await vi.waitFor(() => expect(service.isRunning('chat-1')).toBe(true))

    await expect(service.settleRuns(40)).resolves.toBe(false)

    release()
    mocks.beforePrepareStep = undefined
    await running
    await expect(service.settleRuns(1000)).resolves.toBe(true)
  })

  it('marks a task failed when its executor cannot start and surfaces it via await', async () => {
    const deps = createDeps()
    deps.store.resolveAgentDefinition.mockImplementationOnce(async () => {
      throw new Error('child exploded')
    })
    const service = createAgentService(deps as never)

    const task = service.spawnTask({
      parentChatId: 'parent',
      objective: 'do work',
      agentType: 'research'
    })
    expect(task.id).toBe('research-1')

    const result = await service.awaitTask('parent', 'research-1')
    expect(result.failed).toBe(true)
    expect(result.errorMessage).toContain('child exploded')
    expect(service.getTask('parent', 'research-1')?.status).toBe('failed')
    expect(deps.store.save).not.toHaveBeenCalledWith(
      'parent',
      expect.arrayContaining([
        expect.objectContaining({ parts: [expect.objectContaining({ type: 'text' })] })
      ])
    )
  })

  it('carries the stream failure into the terminal run-state event', async () => {
    const deps = createDeps()
    const finishSpy = vi.spyOn(deps.streams, 'finish')
    mocks.failStream = true
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(finishSpy).toHaveBeenCalledWith('chat-1', expect.any(String), 'failed', {
      code: 'CHAT_RUN_FAILED',
      message: 'bad api key'
    })
    expect(deps.store.markRunOutcome).toHaveBeenCalledWith(
      'chat-1',
      expect.any(String),
      'failed',
      expect.stringContaining('stream-error')
    )
  })

  it('marks successful runs as finished in the run ledger', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)

    await service.run('chat-1', [userMessage])

    expect(deps.store.markRunOutcome).toHaveBeenCalledWith(
      'chat-1',
      expect.any(String),
      'finished',
      undefined
    )
  })

  it('serializes concurrent sends to the same chat through the mailbox', async () => {
    const deps = createDeps()
    const service = createAgentService(deps as never)
    let release!: () => void
    mocks.stepHasToolCall = false
    mocks.beforePrepareStep = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const first = service.run('chat-1', [userMessage])
    await vi.waitFor(() => expect(service.isRunning('chat-1')).toBe(true))
    const second = service.run('chat-1', [{ ...userMessage, id: 'user-2' }])
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(mocks.buildAgent).toHaveBeenCalledTimes(1)

    release()
    mocks.beforePrepareStep = undefined
    await first
    await second

    expect(mocks.buildAgent).toHaveBeenCalledTimes(2)
    expect(service.isRunning('chat-1')).toBe(false)
  })

  it('queues manual compaction behind the active run instead of racing it', async () => {
    const deps = createDeps()
    mocks.planCompaction.mockResolvedValue(null)
    const service = createAgentService(deps as never)
    let release!: () => void
    mocks.beforePrepareStep = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const running = service.run('chat-1', [userMessage])
    await vi.waitFor(() => expect(service.isRunning('chat-1')).toBe(true))
    const compacting = service.compact('chat-1')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(mocks.planCompaction).not.toHaveBeenCalled()

    release()
    mocks.beforePrepareStep = undefined
    await running
    const notNeededOutcome = await compacting

    expect(notNeededOutcome).toBe('not-needed')
    expect(mocks.planCompaction).toHaveBeenCalled()
  })
})
