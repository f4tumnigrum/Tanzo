import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessageChunk } from 'ai'
import type { ChatEvent, ChatRunStatus } from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  getChatSession,
  resetChatSessions,
  type ChatSession
} from '@renderer/features/chat/model/conversation/session-manager'

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
    editMessage: vi.fn(async () => undefined),
    respondApprovals: vi.fn(async () => ({ started: true })),
    retryTurn: vi.fn(async () => undefined),
    lastRunOutcome: vi.fn(async () => null),
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

/** Node test env has no rAF — the transcript pump uses timers; drain them. */
async function drain(session: ChatSession): Promise<void> {
  await flush()
  session.transcript.flushSync()
  await flush()
  session.transcript.flushSync()
}

function messages(session: ChatSession): readonly TanzoUIMessage[] {
  session.transcript.flushSync()
  return session.transcript.getMessages()
}

function messageIds(session: ChatSession): string[] {
  return messages(session).map((message) => message.id)
}

function userMessage(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

let chatCounter = 0

function openSession(history: TanzoUIMessage[] = []): {
  chatId: string
  session: ChatSession
  release: () => void
} {
  chatCounter += 1
  const chatId = `chat-${chatCounter}`
  mocks.messagesByChat.set(chatId, history)
  const session = getChatSession(chatId)
  const release = session.retain()
  return { chatId, session, release }
}

describe('renderer/session-manager', () => {
  beforeEach(() => {
    resetChatSessions()
    vi.clearAllMocks()
    seq = 0
    mocks.chatClient.runSnapshot.mockResolvedValue(null)
    mocks.goalClient.get.mockResolvedValue(null)
  })

  it('loads history and sidecar state on open', async () => {
    const history = [userMessage('m1', 'hello')]
    const { session } = openSession(history)

    await drain(session)

    expect(messages(session)).toEqual(history)
    expect(session.runState.getState().isLoadingHistory).toBe(false)
    expect(session.sidecar.getState().queuedMessages).toEqual(['queued-1'])
    expect(session.runState.getState().isStreaming).toBe(false)
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

    await drain(session)

    expect(mocks.chatClient.contextSnapshot).toHaveBeenCalledWith(expect.any(String))
    expect(session.runState.getState().contextStatus).toMatchObject({
      usedTokens: 42,
      compactionTriggerTokens: 100
    })
  })

  it('streams a run from run-start through settle and refreshes from the store', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

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
    await drain(session)
    expect(session.runState.getState().isStreaming).toBe(true)
    expect(messages(session)).toHaveLength(2)

    emitFrame(chatId, 'run-1', { type: 'start', messageId: 'a1' })
    emitFrame(chatId, 'run-1', { type: 'text-start', id: 't1' })
    emitFrame(chatId, 'run-1', { type: 'text-delta', id: 't1', delta: 'Hi there' })
    await drain(session)

    expect(messages(session).at(-1)).toMatchObject({ id: 'a1', role: 'assistant' })

    const settled = [
      ...history,
      userMessage('m2', 'next question'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] } as TanzoUIMessage
    ]
    mocks.messagesByChat.set(chatId, settled)
    emitFrame(chatId, 'run-1', { type: 'text-end', id: 't1' })
    emitFrame(chatId, 'run-1', { type: 'finish' })
    emitState(chatId, 'run-1', 'finished')
    await drain(session)
    await drain(session)

    expect(session.runState.getState().isStreaming).toBe(false)
    expect(messages(session)).toEqual(settled)
    expect(mocks.queryClient.setQueryData).toHaveBeenCalled()
  })

  it('accepts tick-batched frames from the main process', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

    mocks.chatClient.runSnapshot.mockResolvedValue({
      chatId,
      runId: 'run-b',
      runKind: 'chat',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-b', 'running')
    await drain(session)

    emit(chatId, {
      kind: 'run-frame-batch',
      chatId,
      runId: 'run-b',
      frames: [
        {
          kind: 'run-frame',
          chatId,
          runId: 'run-b',
          seq: 1,
          chunk: { type: 'start', messageId: 'a1' }
        },
        {
          kind: 'run-frame',
          chatId,
          runId: 'run-b',
          seq: 2,
          chunk: { type: 'text-start', id: 't1' }
        },
        {
          kind: 'run-frame',
          chatId,
          runId: 'run-b',
          seq: 3,
          chunk: { type: 'text-delta', id: 't1', delta: 'Batched' }
        }
      ]
    } as never)
    await drain(session)

    const last = messages(session).at(-1)
    expect(last).toMatchObject({ id: 'a1', role: 'assistant' })
    expect(last?.parts).toMatchObject([{ type: 'text', text: 'Batched' }])
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
    await drain(session)

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
    await drain(session)

    expect(messageIds(session)).toEqual(['m1', 'summary-1', 'm2', 'm3'])
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

    await drain(session)
    expect(messageIds(session)).toEqual(['summary-2', 'm2', 'm3'])

    resolveHistory()
    await drain(session)
    await drain(session)

    expect(messageIds(session)).toEqual(['m1', 'summary-2', 'm2', 'm3'])
  })

  it('routes notification data parts into sidecar state while idle', async () => {
    const { chatId, session } = openSession()
    await drain(session)

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: { type: 'data-queued', id: `queued:${chatId}`, data: { items: ['a', 'b'] } } as never
    })

    expect(session.sidecar.getState().queuedMessages).toEqual(['a', 'b'])
  })

  it('does not inject compaction into the ordered message list and refreshes from the store on complete', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-1',
        data: { stage: 'start', auto: true, summaryId: 'summary-1' }
      } as never
    })
    expect(messages(session)).toEqual(history)
    expect(session.runState.getState().compactionInProgress).toMatchObject({
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
    await drain(session)
    await drain(session)

    expect(session.runState.getState().compactionInProgress).toBeNull()
    expect(messageIds(session)).toEqual(['summary-1'])
  })

  it('keeps a divider source while the store has not yet returned the summary on complete', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-3',
        data: { stage: 'start', auto: true, summaryId: 'summary-3' }
      } as never
    })
    expect(session.runState.getState().compactionInProgress).toMatchObject({ stage: 'start' })

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-3',
        data: { stage: 'complete', auto: true, summaryId: 'summary-3', summary: 'summary' }
      } as never
    })
    await drain(session)
    await drain(session)

    expect(session.runState.getState().compactionInProgress).toMatchObject({
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
    session.transcript.flushSync()

    expect(session.runState.getState().compactionInProgress).toBeNull()
    expect(messageIds(session)).toEqual(['summary-3'])
  })

  it('clears the divider indicator immediately when compaction fails', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-4',
        data: { stage: 'start', auto: true, summaryId: 'summary-4' }
      } as never
    })
    expect(session.runState.getState().compactionInProgress).toMatchObject({ stage: 'start' })

    emit(chatId, {
      kind: 'notification',
      chatId,
      chunk: {
        type: 'data-compaction',
        id: 'compaction:summary-4',
        data: { stage: 'failed', auto: true, summaryId: 'summary-4', summary: 'boom' }
      } as never
    })
    await drain(session)

    expect(session.runState.getState().compactionInProgress).toBeNull()
    expect(messageIds(session)).toEqual(['m1'])
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
    await drain(session)

    expect(session.runState.getState().activeRunKind).toBe('compaction')
    expect(session.runState.getState().compactionInProgress).toMatchObject({
      stage: 'start',
      summaryId: 'summary-2'
    })
    expect(messages(session)).toEqual(history)
  })

  it('treats a compaction run as streaming+abortable without creating an assistant message', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

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
    await drain(session)

    expect(session.runState.getState().isStreaming).toBe(true)
    expect(session.runState.getState().activeRunKind).toBe('compaction')

    emitFrame(chatId, 'run-c1', {
      type: 'data-compaction',
      id: 'compaction:run-c1',
      data: { stage: 'start', auto: true, summaryId: 'sum-c1', summary: 'partial…' }
    } as never)
    emitFrame(chatId, 'run-c1', { type: 'start', messageId: 'should-not-appear' })
    emitFrame(chatId, 'run-c1', { type: 'text-start', id: 'x' })
    emitFrame(chatId, 'run-c1', { type: 'text-delta', id: 'x', delta: 'nope' })
    await drain(session)

    expect(session.runState.getState().compactionInProgress).toMatchObject({
      stage: 'start',
      summaryId: 'sum-c1'
    })
    expect(messageIds(session)).toEqual(['m1'])

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
    await drain(session)
    await drain(session)

    expect(session.runState.getState().isStreaming).toBe(false)
    expect(session.runState.getState().activeRunKind).toBeNull()
    expect(session.runState.getState().compactionInProgress).toBeNull()
    expect(messageIds(session)).toEqual(['sum-c1'])
  })

  it('appends an optimistic user message on send and reports submit failures', async () => {
    const { chatId, session } = openSession()
    await drain(session)

    session.sendMessage({ text: 'do the thing' })
    expect(session.runState.getState().isStreaming).toBe(true)
    expect(messages(session).at(-1)).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'do the thing' }]
    })
    expect(mocks.chatClient.submit).toHaveBeenCalledWith(
      chatId,
      expect.objectContaining({ role: 'user' })
    )

    mocks.chatClient.submit.mockRejectedValueOnce(new Error('model exploded'))
    const beforeFailedSend = messages(session).length
    session.sendMessage({ text: 'again' })
    expect(messages(session).length).toBe(beforeFailedSend + 1)
    await drain(session)
    expect(session.runState.getState().runNotice).toMatchObject({
      kind: 'error',
      error: { message: 'model exploded' }
    })
    expect(session.runState.getState().isStreaming).toBe(false)
    expect(messages(session).length).toBe(beforeFailedSend)
    expect(messages(session).at(-1)).not.toMatchObject({
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
    await drain(session)

    await session.respondApprovals([{ approvalId: 'approval-1', approved: true, scope: 'session' }])

    expect(messages(session)[0]?.parts[0]).toMatchObject({
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
    await drain(session)
    mocks.chatClient.respondApprovals.mockRejectedValueOnce(new Error('approval failed'))

    await expect(
      session.respondApprovals([{ approvalId: 'approval-1', approved: true, scope: 'session' }])
    ).rejects.toThrow('approval failed')

    expect(messages(session)[0]?.parts[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'approval-1' }
    })
    expect(session.runState.getState().isStreaming).toBe(false)
    expect(session.runState.getState().runNotice).toMatchObject({
      kind: 'error',
      error: { message: 'approval failed' }
    })
  })

  it('streams the chat run that follows an auto-compaction run when its snapshot is available', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

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
    await drain(session)
    expect(session.runState.getState().activeRunKind).toBe('compaction')

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
    await drain(session)
    await drain(session)

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
    await drain(session)

    expect(session.runState.getState().activeRunKind).toBe('chat')

    emitFrame(chatId, 'run-chat', { type: 'start', messageId: 'a1' })
    emitFrame(chatId, 'run-chat', { type: 'text-start', id: 't1' })
    emitFrame(chatId, 'run-chat', { type: 'text-delta', id: 't1', delta: 'The answer' })
    await drain(session)

    // The streaming assistant message must be visible.
    expect(messages(session).at(-1)).toMatchObject({ id: 'a1', role: 'assistant' })
  })

  it('REPRO: drops the chat run after compaction when its snapshot resolves null', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

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
    await drain(session)
    expect(session.runState.getState().activeRunKind).toBe('compaction')

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
    await drain(session)
    await drain(session)

    // 2) Chat run starts, but runSnapshot returns null (main side hasn't published
    //    the running session yet by the time the renderer queries). The connection
    //    is persistent, so attach() locks onto the runId via the null-snapshot path.
    mocks.chatClient.runSnapshot.mockResolvedValue(null)
    emitState(chatId, 'run-chat', 'running')
    await drain(session)

    // 3) Chat run streams its response frames.
    emitFrame(chatId, 'run-chat', { type: 'start', messageId: 'a1' })
    emitFrame(chatId, 'run-chat', { type: 'text-start', id: 't1' })
    emitFrame(chatId, 'run-chat', { type: 'text-delta', id: 't1', delta: 'The answer' })
    await drain(session)

    // The run is happening, but the streaming assistant message must still surface.
    expect(messages(session).at(-1)).toMatchObject({ id: 'a1', role: 'assistant' })
  })

  it('keeps idle sessions alive for hot switching and evicts the oldest beyond the cap', async () => {
    const {
      chatId: first,
      session: firstSession,
      release: releaseFirst
    } = openSession([userMessage('m1', 'hello')])
    await drain(firstSession)
    releaseFirst()

    // Reacquiring the same chat returns the same (kept-alive) session.
    expect(getChatSession(first)).toBe(firstSession)

    // Opening more sessions than the idle cap evicts the oldest released one.
    const retained: Array<() => void> = []
    for (let i = 0; i < 6; i += 1) {
      const { session, release } = openSession([])
      await drain(session)
      retained.push(release)
    }
    for (const release of retained) release()
    openSession([]) // triggers eviction pass

    expect(getChatSession(first)).not.toBe(firstSession)
  })

  it('shows an aborted notice when a chat run is stopped by the user', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

    mocks.chatClient.runSnapshot.mockResolvedValue({
      chatId,
      runId: 'run-1',
      runKind: 'chat',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-1', 'running')
    await drain(session)
    expect(session.runState.getState().isStreaming).toBe(true)

    session.stop()
    expect(session.runState.getState().isStopping).toBe(true)
    expect(mocks.chatClient.cancel).toHaveBeenCalledWith(chatId)

    emitState(chatId, 'run-1', 'aborted')
    await drain(session)
    await drain(session)

    const state = session.runState.getState()
    expect(state.isStreaming).toBe(false)
    expect(state.isStopping).toBe(false)
    expect(state.runNotice).toEqual({ kind: 'aborted' })
  })

  it('clears the stopping flag and reports the failure when the cancel IPC rejects', async () => {
    const history = [userMessage('m1', 'hello')]
    const { chatId, session } = openSession(history)
    await drain(session)

    mocks.chatClient.runSnapshot.mockResolvedValue({
      chatId,
      runId: 'run-1',
      runKind: 'chat',
      status: 'running',
      baseMessages: history,
      notifications: [],
      frames: []
    } as never)
    emitState(chatId, 'run-1', 'running')
    await drain(session)

    mocks.chatClient.cancel.mockRejectedValueOnce(new Error('ipc down'))
    session.stop()
    await drain(session)

    expect(session.runState.getState().isStopping).toBe(false)
  })

  it('retries the last turn optimistically and surfaces an IPC failure', async () => {
    mocks.chatClient.retryTurn.mockRejectedValueOnce(new Error('retry failed'))
    const { chatId, session } = openSession([userMessage('m1', 'hello')])
    await drain(session)

    session.retryLastTurn()
    expect(session.runState.getState().isStreaming).toBe(true)
    expect(session.runState.getState().runNotice).toBeNull()
    expect(mocks.chatClient.retryTurn).toHaveBeenCalledWith(chatId)

    await drain(session)
    // The catch handler surfaces the failure; runActive is false so streaming clears.
    expect(session.runState.getState().isStreaming).toBe(false)
    expect(session.runState.getState().runNotice).toMatchObject({ kind: 'error' })

    // A retry while already streaming is a no-op.
    session.retryLastTurn()
    session.retryLastTurn()
    expect(mocks.chatClient.retryTurn).toHaveBeenCalledTimes(2)
  })

  it('restores a persisted failure notice when opening an idle chat', async () => {
    mocks.chatClient.lastRunOutcome.mockResolvedValue({
      runId: 'run-9',
      status: 'failed',
      finishedAt: 123,
      error: {
        kind: 'stream-error',
        message: 'Rate limited',
        code: 'AISDK_API_CALL_ERROR',
        detail: { kind: 'api', message: 'Rate limited', statusCode: 429 }
      }
    } as never)
    const { session } = openSession([userMessage('m1', 'hello')])
    await drain(session)
    await drain(session)

    expect(session.runState.getState().runNotice).toMatchObject({
      kind: 'error',
      stale: true,
      error: { kind: 'api', statusCode: 429 }
    })
  })

  it('edits the trailing user prompt even when a context injection follows it', async () => {
    const injection: TanzoUIMessage = {
      id: 'inj-1',
      role: 'user',
      parts: [{ type: 'data-contextInjection', data: { text: 'datetime: now' } } as never]
    }
    const { chatId, session } = openSession([userMessage('u1', 'original'), injection])
    await flush()

    session.editMessage('u1', 'edited prompt')
    await flush()

    expect(mocks.chatClient.editMessage).toHaveBeenCalledWith(chatId, 'u1', 'edited prompt')
    // The optimistic transcript drops the trailing injection and keeps the
    // edited prompt as the last message.
    const messages = session.transcript.getMessages()
    expect(messages.at(-1)).toMatchObject({
      id: 'u1',
      parts: [{ type: 'text', text: 'edited prompt' }]
    })
    expect(messages.some((message) => message.id === 'inj-1')).toBe(false)
    expect(session.runState.getState().isStreaming).toBe(true)
  })

  it('rejects an edit when a real reply follows the target', async () => {
    const assistantReply: TanzoUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'reply' }]
    }
    const { session } = openSession([userMessage('u1', 'original'), assistantReply])
    await flush()

    session.editMessage('u1', 'edited prompt')
    await flush()

    expect(mocks.chatClient.editMessage).not.toHaveBeenCalled()
  })

  it('does not restore a notice for finished or aborted outcomes', async () => {
    mocks.chatClient.lastRunOutcome.mockResolvedValue({
      runId: 'run-9',
      status: 'failed',
      finishedAt: 123,
      error: { kind: 'aborted' }
    } as never)
    const { session } = openSession([userMessage('m1', 'hello')])
    await drain(session)
    await drain(session)

    expect(session.runState.getState().runNotice).toBeNull()
  })
})
