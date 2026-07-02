import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessageChunk } from 'ai'
import type { ChatEvent, ChatRunStatus } from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import { getChatSession } from '@renderer/features/chat/model/conversation/chat-session'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: ChatEvent) => void>>()
  const messagesByChat = new Map<string, TanzoUIMessage[]>()
  const chatClient = {
    onEvent: vi.fn((chatId: string, listener: (event: ChatEvent) => void) => {
      const set = listeners.get(chatId) ?? new Set()
      set.add(listener)
      listeners.set(chatId, set)
      return () => set.delete(listener)
    }),
    runSnapshot: vi.fn(async () => null),
    contextSnapshot: vi.fn(async () => null),
    listMessages: vi.fn(async (chatId: string) => messagesByChat.get(chatId) ?? []),
    getConversation: vi.fn(async (chatId: string) => ({ id: chatId, archivedAt: null })),
    listQueued: vi.fn(async () => ['queued-1']),
    pendingTaskApprovals: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    approveTask: vi.fn(async () => undefined),
    retryTask: vi.fn(async () => undefined),
    cancelTask: vi.fn(async () => undefined),
    onTaskEvent: vi.fn(() => () => undefined),
    submit: vi.fn(async () => undefined),
    respondApprovals: vi.fn(async () => ({ started: true })),
    cancel: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
    removeQueued: vi.fn(async () => undefined)
  }
  const goalClient = {
    get: vi.fn(async () => null),
    clear: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => null),
    updateObjective: vi.fn(async () => null),
    create: vi.fn(async () => null)
  }
  const queryClient = { setQueryData: vi.fn(), getQueryData: vi.fn() }
  return { listeners, messagesByChat, chatClient, goalClient, queryClient }
})

vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@/platform/electron/chat-client', () => ({ chatClient: mocks.chatClient }))
vi.mock('@/platform/electron/goal-client', () => ({ goalClient: mocks.goalClient }))
vi.mock('@/common/query-client', () => ({ queryClient: mocks.queryClient }))

let seq = 0

function emit(chatId: string, event: ChatEvent): void {
  for (const listener of mocks.listeners.get(chatId) ?? []) listener(event)
}

function emitFrame(chatId: string, runId: string, chunk: UIMessageChunk): void {
  seq += 1
  emit(chatId, { kind: 'run-frame', chatId, runId, seq, chunk })
}

function emitState(
  chatId: string,
  runId: string,
  status: ChatRunStatus,
  runKind: 'chat' | 'compaction' = 'chat'
): void {
  emit(chatId, { kind: 'run-state', chatId, runId, runKind, status })
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function userMessage(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

let chatCounter = 0

function openSession(history: TanzoUIMessage[] = []): {
  chatId: string
  session: ReturnType<typeof getChatSession>
  release: () => void
} {
  chatCounter += 1
  const chatId = `chat-${chatCounter}`
  mocks.messagesByChat.set(chatId, history)
  const session = getChatSession(chatId)
  const release = session.retain()
  return { chatId, session, release }
}

describe('renderer/chat-session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seq = 0
    mocks.chatClient.runSnapshot.mockResolvedValue(null)
    mocks.goalClient.get.mockResolvedValue(null)
  })

  it('loads history and sidecar state on open', async () => {
    const history = [userMessage('m1', 'hello')]
    const { session } = openSession(history)

    await flush()

    const state = session.getState()
    expect(state.messages).toEqual(history)
    expect(state.isLoadingHistory).toBe(false)
    expect(state.queuedMessages).toEqual(['queued-1'])
    expect(state.isStreaming).toBe(false)
  })

  it('hydrates the context-usage indicator from a recomputed snapshot on open', async () => {
    mocks.chatClient.contextSnapshot.mockResolvedValueOnce({
      source: 'reported',
      usedTokens: 42,
      compactionTriggerTokens: 100,
      windowTokens: 200,
      compactionTriggered: false,
      cacheKind: 'auto',
      serverCompaction: false
    } as never)
    const { session } = openSession([userMessage('m1', 'hello')])

    await flush()

    expect(mocks.chatClient.contextSnapshot).toHaveBeenCalledWith(expect.any(String))
    expect(session.getState().contextStatus).toMatchObject({
      usedTokens: 42,
      compactionTriggerTokens: 100
    })
  })

  it('streams a run from run-start through settle and refreshes from the store', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    mocks.chatClient.runSnapshot.mockResolvedValue({
      chatId,
      runId: 'run-1',
      runKind: 'chat',
      status: 'running',
      baseMessages: [...history, userMessage('m2', 'next question')],
      notifications: [],
      frames: []
    } as never)

    emitState(chatId, 'run-1', 'running')
    await flush()
    expect(session.getState().isStreaming).toBe(true)
    expect(session.getState().messages).toHaveLength(2)

    emitFrame(chatId, 'run-1', { type: 'start', messageId: 'a1' })
    emitFrame(chatId, 'run-1', { type: 'text-start', id: 't1' })
    emitFrame(chatId, 'run-1', { type: 'text-delta', id: 't1', delta: 'Hi there' })
    await flush()

    const streaming = session.getState().messages
    expect(streaming.at(-1)).toMatchObject({ id: 'a1', role: 'assistant' })

    const settled = [
      ...history,
      userMessage('m2', 'next question'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] } as TanzoUIMessage
    ]
    mocks.messagesByChat.set(chatId, settled)
    emitFrame(chatId, 'run-1', { type: 'text-end', id: 't1' })
    emitFrame(chatId, 'run-1', { type: 'finish' })
    emitState(chatId, 'run-1', 'finished')
    await flush()
    await flush()

    const state = session.getState()
    expect(state.isStreaming).toBe(false)
    expect(state.messages).toEqual(settled)
    expect(mocks.queryClient.setQueryData).toHaveBeenCalled()
  })

  it('preserves display history when a run snapshot contains compacted context only', async () => {
    const summary = {
      id: 'summary-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'summary' },
        { type: 'data-compaction', data: { stage: 'complete', summaryId: 'summary-1' } }
      ]
    } as TanzoUIMessage
    const displayHistory = [userMessage('m1', 'old'), summary, userMessage('m2', 'tail')]
    const { chatId, session } = openSession(displayHistory)
    await flush()

    mocks.chatClient.runSnapshot.mockResolvedValue({
      chatId,
      runId: 'run-compact-context',
      runKind: 'chat',
      status: 'running',
      baseMessages: [summary, userMessage('m2', 'tail'), userMessage('m3', 'new question')],
      notifications: [],
      frames: []
    } as never)

    emitState(chatId, 'run-compact-context', 'running')
    await flush()

    expect(session.getState().messages.map((message) => message.id)).toEqual([
      'm1',
      'summary-1',
      'm2',
      'm3'
    ])
  })

  it('merges delayed display history into an active compacted run snapshot', async () => {
    const summary = {
      id: 'summary-2',
      role: 'user',
      parts: [
        { type: 'text', text: 'summary' },
        { type: 'data-compaction', data: { stage: 'complete', summaryId: 'summary-2' } }
      ]
    } as TanzoUIMessage
    const displayHistory = [userMessage('m1', 'old'), summary, userMessage('m2', 'tail')]
    let resolveHistory!: () => void
    const delayedHistory = new Promise<TanzoUIMessage[]>((resolve) => {
      resolveHistory = () => resolve(displayHistory)
    })
    mocks.chatClient.listMessages.mockImplementationOnce(async () => delayedHistory)
    mocks.chatClient.runSnapshot.mockImplementationOnce(async (chatId: string) => ({
      chatId,
      runId: 'run-before-history',
      runKind: 'chat',
      status: 'running',
      baseMessages: [summary, userMessage('m2', 'tail'), userMessage('m3', 'new question')],
      notifications: [],
      frames: []
    }))
    const { session } = openSession()

    await flush()
    expect(session.getState().messages.map((message) => message.id)).toEqual([
      'summary-2',
      'm2',
      'm3'
    ])

    resolveHistory()
    await flush()
    await flush()

    expect(session.getState().messages.map((message) => message.id)).toEqual([
      'm1',
      'summary-2',
      'm2',
      'm3'
    ])
  })

  it('routes notification data parts into session state while idle', async () => {
    const { chatId, session } = openSession()
    await flush()

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: { type: 'data-queued', id: `queued:${chatId}`, data: { items: ['a', 'b'] } } as never
    })

    expect(session.getState().queuedMessages).toEqual(['a', 'b'])
  })

  it('does not inject compaction into the ordered message list and refreshes from the store on complete', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-1',
        data: { stage: 'start', auto: true, summaryId: 'summary-1' }
      } as never
    })
    expect(session.getState().messages).toEqual(history)
    expect(session.getState().compactionInProgress).toMatchObject({
      stage: 'start',
      summaryId: 'summary-1'
    })

    const compacted = [
      {
        id: 'summary-1',
        role: 'user',
        parts: [
          { type: 'text', text: 'summary' },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: 'summary-1' } }
        ]
      } as TanzoUIMessage
    ]
    mocks.messagesByChat.set(chatId, compacted)
    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-1',
        data: { stage: 'complete', auto: true, summaryId: 'summary-1', summary: 'summary' }
      } as never
    })
    await flush()
    await flush()

    expect(session.getState().compactionInProgress).toBeNull()
    expect(session.getState().messages.map((message) => message.id)).toEqual(['summary-1'])
  })

  it('keeps a divider source while the store has not yet returned the summary on complete', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-3',
        data: { stage: 'start', auto: true, summaryId: 'summary-3' }
      } as never
    })
    expect(session.getState().compactionInProgress).toMatchObject({ stage: 'start' })

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-3',
        data: { stage: 'complete', auto: true, summaryId: 'summary-3', summary: 'summary' }
      } as never
    })
    await flush()
    await flush()

    expect(session.getState().compactionInProgress).toMatchObject({
      stage: 'complete',
      summaryId: 'summary-3'
    })

    const compacted = [
      {
        id: 'summary-3',
        role: 'user',
        parts: [
          { type: 'text', text: 'summary' },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: 'summary-3' } }
        ]
      } as TanzoUIMessage
    ]
    mocks.messagesByChat.set(chatId, compacted)
    await session.refresh()

    expect(session.getState().compactionInProgress).toBeNull()
    expect(session.getState().messages.map((message) => message.id)).toEqual(['summary-3'])
  })

  it('clears the divider indicator immediately when compaction fails', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-4',
        data: { stage: 'start', auto: true, summaryId: 'summary-4' }
      } as never
    })
    expect(session.getState().compactionInProgress).toMatchObject({ stage: 'start' })

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-4',
        data: { stage: 'failed', auto: true, summaryId: 'summary-4', summary: 'boom' }
      } as never
    })
    await flush()

    expect(session.getState().compactionInProgress).toBeNull()
    expect(session.getState().messages.map((message) => message.id)).toEqual(['m1'])
  })

  it('restores an in-progress compaction indicator from the run snapshot on open', async () => {
    const history = [userMessage('m1', 'hello')]
    chatCounter += 1
    const chatId = `chat-${chatCounter}`
    mocks.messagesByChat.set(chatId, history)
    mocks.chatClient.runSnapshot.mockResolvedValue({
      chatId,
      runId: 'run-c2',
      runKind: 'compaction',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: [
        {
          runId: 'run-c2',
          seq: 1,
          chunk: {
            type: 'data-compaction',
            id: 'compaction:summary-2',
            data: { stage: 'start', auto: true, summaryId: 'summary-2' }
          }
        }
      ]
    } as never)
    const session = getChatSession(chatId)
    session.retain()
    await flush()

    expect(session.getState().activeRunKind).toBe('compaction')
    expect(session.getState().compactionInProgress).toMatchObject({
      stage: 'start',
      summaryId: 'summary-2'
    })
    expect(session.getState().messages).toEqual(history)
  })

  it('treats a compaction run as streaming+abortable without creating an assistant message', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    mocks.chatClient.runSnapshot.mockResolvedValueOnce({
      chatId,
      runId: 'run-c1',
      runKind: 'compaction',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-c1', 'running', 'compaction')
    await flush()

    expect(session.getState().isStreaming).toBe(true)
    expect(session.getState().activeRunKind).toBe('compaction')

    emitFrame(chatId, 'run-c1', {
      type: 'data-compaction',
      id: 'compaction:run-c1',
      data: { stage: 'start', auto: true, summaryId: 'sum-c1', summary: 'partial…' }
    } as never)
    emitFrame(chatId, 'run-c1', { type: 'start', messageId: 'should-not-appear' })
    emitFrame(chatId, 'run-c1', { type: 'text-start', id: 'x' })
    emitFrame(chatId, 'run-c1', { type: 'text-delta', id: 'x', delta: 'nope' })
    await flush()

    expect(session.getState().compactionInProgress).toMatchObject({
      stage: 'start',
      summaryId: 'sum-c1'
    })
    expect(session.getState().messages.map((m) => m.id)).toEqual(['m1'])

    const compacted = [
      {
        id: 'sum-c1',
        role: 'user',
        parts: [
          { type: 'text', text: 'summary' },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: 'sum-c1' } }
        ]
      } as TanzoUIMessage
    ]
    mocks.messagesByChat.set(chatId, compacted)
    emitState(chatId, 'run-c1', 'finished', 'compaction')
    await flush()
    await flush()

    expect(session.getState().isStreaming).toBe(false)
    expect(session.getState().activeRunKind).toBeNull()
    expect(session.getState().compactionInProgress).toBeNull()
    expect(session.getState().messages.map((m) => m.id)).toEqual(['sum-c1'])
  })

  it('appends an optimistic user message on send and reports submit failures', async () => {
    const { chatId, session } = openSession()
    await flush()

    session.sendMessage({ text: 'do the thing' })
    expect(session.getState().isStreaming).toBe(true)
    expect(session.getState().messages.at(-1)).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'do the thing' }]
    })
    expect(mocks.chatClient.submit).toHaveBeenCalledWith(
      chatId,
      expect.objectContaining({ role: 'user' })
    )

    mocks.chatClient.submit.mockRejectedValueOnce(new Error('model exploded'))
    const beforeFailedSend = session.getState().messages.length
    session.sendMessage({ text: 'again' })
    expect(session.getState().messages.length).toBe(beforeFailedSend + 1)
    await flush()
    expect(session.getState().runNotice).toMatchObject({
      kind: 'error',
      error: { message: 'model exploded' }
    })
    expect(session.getState().isStreaming).toBe(false)
    expect(session.getState().messages.length).toBe(beforeFailedSend)
    expect(session.getState().messages.at(-1)).not.toMatchObject({
      parts: [{ type: 'text', text: 'again' }]
    })
  })

  it('optimistically patches approval responses and forwards them to the main process', async () => {
    const history = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.ts' },
            approval: { id: 'approval-1' }
          }
        ]
      } as TanzoUIMessage
    ]
    const { chatId, session } = openSession(history)
    await flush()

    await session.respondApprovals([{ approvalId: 'approval-1', approved: true, scope: 'session' }])

    expect(session.getState().messages[0]?.parts[0]).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'approval-1', approved: true }
    })
    expect(mocks.chatClient.respondApprovals).toHaveBeenCalledWith(chatId, [
      { approvalId: 'approval-1', approved: true, scope: 'session' }
    ])
  })

  it('rolls back optimistic approval state when the IPC call fails', async () => {
    const history = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.ts' },
            approval: { id: 'approval-1' }
          }
        ]
      } as TanzoUIMessage
    ]
    const { session } = openSession(history)
    await flush()
    mocks.chatClient.respondApprovals.mockRejectedValueOnce(new Error('approval failed'))

    await expect(
      session.respondApprovals([{ approvalId: 'approval-1', approved: true, scope: 'session' }])
    ).rejects.toThrow('approval failed')

    expect(session.getState().messages[0]?.parts[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'approval-1' }
    })
    expect(session.getState().isStreaming).toBe(false)
    expect(session.getState().runNotice).toMatchObject({
      kind: 'error',
      error: { message: 'approval failed' }
    })
  })

  it('streams the chat run that follows an auto-compaction run when its snapshot is available', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    // 1) Auto-compaction run: starts, streams a compaction status, finishes.
    mocks.chatClient.runSnapshot.mockResolvedValueOnce({
      chatId,
      runId: 'run-compact',
      runKind: 'compaction',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-compact', 'running', 'compaction')
    await flush()
    expect(session.getState().activeRunKind).toBe('compaction')

    const compacted = [
      {
        id: 'sum-1',
        role: 'user',
        parts: [
          { type: 'text', text: 'summary' },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: 'sum-1' } }
        ]
      } as TanzoUIMessage,
      userMessage('m2', 'next question')
    ]
    mocks.messagesByChat.set(chatId, compacted)
    emitState(chatId, 'run-compact', 'finished', 'compaction')
    await flush()
    await flush()

    // 2) Chat run: run-state:running arrives, snapshot is available immediately.
    mocks.chatClient.runSnapshot.mockResolvedValueOnce({
      chatId,
      runId: 'run-chat',
      runKind: 'chat',
      status: 'running',
      baseMessages: compacted,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-chat', 'running')
    await flush()

    expect(session.getState().activeRunKind).toBe('chat')

    emitFrame(chatId, 'run-chat', { type: 'start', messageId: 'a1' })
    emitFrame(chatId, 'run-chat', { type: 'text-start', id: 't1' })
    emitFrame(chatId, 'run-chat', { type: 'text-delta', id: 't1', delta: 'The answer' })
    await flush()

    // The streaming assistant message must be visible.
    expect(session.getState().messages.at(-1)).toMatchObject({ id: 'a1', role: 'assistant' })
  })

  it('REPRO: drops the chat run after compaction when its snapshot resolves null', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await flush()

    // 1) Auto-compaction run finishes.
    mocks.chatClient.runSnapshot.mockResolvedValueOnce({
      chatId,
      runId: 'run-compact',
      runKind: 'compaction',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-compact', 'running', 'compaction')
    await flush()
    expect(session.getState().activeRunKind).toBe('compaction')

    const compacted = [
      {
        id: 'sum-1',
        role: 'user',
        parts: [
          { type: 'text', text: 'summary' },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: 'sum-1' } }
        ]
      } as TanzoUIMessage,
      userMessage('m2', 'next question')
    ]
    mocks.messagesByChat.set(chatId, compacted)
    emitState(chatId, 'run-compact', 'finished', 'compaction')
    await flush()
    await flush()

    // 2) Chat run starts, but runSnapshot returns null (main side hasn't published
    //    the running session yet by the time the renderer queries). The connection
    //    is persistent, so attach() locks onto the runId via the null-snapshot path.
    mocks.chatClient.runSnapshot.mockResolvedValue(null)
    emitState(chatId, 'run-chat', 'running')
    await flush()

    // 3) Chat run streams its response frames.
    emitFrame(chatId, 'run-chat', { type: 'start', messageId: 'a1' })
    emitFrame(chatId, 'run-chat', { type: 'text-start', id: 't1' })
    emitFrame(chatId, 'run-chat', { type: 'text-delta', id: 't1', delta: 'The answer' })
    await flush()

    // The run is happening, but the streaming assistant message must still surface.
    expect(session.getState().messages.at(-1)).toMatchObject({ id: 'a1', role: 'assistant' })
  })

  it('tears down the session after release and recreates it on the next acquire', async () => {
    vi.useFakeTimers()
    try {
      const { chatId, session, release } = openSession()
      release()
      await vi.advanceTimersByTimeAsync(1100)
      expect(mocks.listeners.get(chatId)?.size ?? 0).toBe(0)
      expect(getChatSession(chatId)).not.toBe(session)
    } finally {
      vi.useRealTimers()
    }
  })
})
