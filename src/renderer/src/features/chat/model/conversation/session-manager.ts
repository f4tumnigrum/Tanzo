import type { FileUIPart, UIMessageChunk } from 'ai'
import type { ChatApprovalResponse, ChatRunKind, ConversationSummary } from '@shared/chat'
import type {
  SubagentTask,
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalView
} from '@shared/subagent-task'
import type { TanzoDataParts, TanzoUIMessage } from '@shared/agent-message'
import { TanzoError } from '@shared/errors'
import { applyApprovalResponses } from '@shared/approval-responses'
import { deriveStatus, GOAL_COMMAND_KEYS, parseGoalCommand, type ThreadGoal } from '@shared/goal'
import i18n from '@/i18n'
import { chatClient } from '@/platform/electron/chat-client'
import { goalClient } from '@/platform/electron/goal-client'
import {
  connectRun,
  createMessageSink,
  type MessageSink,
  type RunConnection
} from '@/platform/electron/run-stream'
import { queryClient } from '@/common/query-client'
import { chatKeys } from '../query-keys'
import { routeDataPart } from './data-part-router'
import { errorKindFromCode, reduceRunNotice, type RunNotice } from './use-run-notice'
import { latestCompaction, trailingUserMessageId } from './message-utils'
import { createTranscriptStore, type TranscriptStore } from './transcript-store'
import { createStateStore, type StateStore } from './state-store'

type Goal = TanzoDataParts['goal']['goal']
type QueuedMessage = TanzoDataParts['queued']['items'][number]

export interface RunState {
  isLoadingHistory: boolean
  isStreaming: boolean

  isStopping: boolean
  transientStatus: string | null
  contextStatus: TanzoDataParts['context'] | null
  recentCompaction: TanzoDataParts['compaction'] | null
  compactionInProgress: TanzoDataParts['compaction'] | null
  activeRunKind: ChatRunKind | null
  runNotice: RunNotice | null
}

export interface SidecarState {
  queuedMessages: QueuedMessage[]
  goal: Goal
  subagentApprovals: SubagentTaskApprovalView[]
  tasks: SubagentTask[]
}

export interface ChatSession {
  chatId: string
  transcript: TranscriptStore
  runState: StateStore<RunState>
  sidecar: StateStore<SidecarState>

  retain(): () => void
  sendMessage(input: { text: string; files?: FileUIPart[] }): void
  editMessage(messageId: string, text: string): void
  respondApprovals(responses: ChatApprovalResponse[]): Promise<void>
  retryLastTurn(): void
  stop(): void
  steer(text: string): void
  enqueue(text: string): void
  removeQueued(id: string): void
  refresh(): Promise<TanzoUIMessage[]>
  clearRunNotice(): void
  respondTaskApproval(response: SubagentTaskApprovalResponse): Promise<void>
  cancelTask(taskId: string): Promise<void>
  retryTask(taskId: string): Promise<void>
  steerTask(taskId: string, instruction: string): Promise<void>
  goalCommand(args: string): Promise<string>
}

const INITIAL_RUN_STATE: RunState = {
  isLoadingHistory: true,
  isStreaming: false,
  isStopping: false,
  transientStatus: null,
  contextStatus: null,
  recentCompaction: null,
  compactionInProgress: null,
  activeRunKind: null,
  runNotice: null
}

const INITIAL_SIDECAR_STATE: SidecarState = {
  queuedMessages: [],
  goal: null,
  subagentApprovals: [],
  tasks: []
}

function toGoalView(goal: ThreadGoal | null): Goal {
  return goal
    ? {
        objective: goal.objective,
        status: deriveStatus(goal),
        tokenBudget: goal.tokenBudget,
        tokensUsed: goal.tokensUsed,
        timeBudgetSeconds: goal.timeBudgetSeconds,
        timeUsedSeconds: goal.timeUsedSeconds
      }
    : null
}

function patchConversationSummary(
  list: ConversationSummary[] | undefined,
  updated: ConversationSummary | null
): ConversationSummary[] | undefined {
  if (!list) return list
  if (!updated || updated.archivedAt !== null || updated.parentRelation === 'subagent') {
    return updated ? list.filter((conversation) => conversation.id !== updated.id) : list
  }
  const existingIndex = list.findIndex((conversation) => conversation.id === updated.id)
  if (existingIndex === -1) return [updated, ...list]
  const next = list.slice()
  next[existingIndex] = updated
  return next
}

function isDataChunk(chunk: UIMessageChunk): chunk is UIMessageChunk & { type: `data-${string}` } {
  return typeof chunk.type === 'string' && chunk.type.startsWith('data-')
}

function isCompactionMarker(message: TanzoUIMessage): boolean {
  return message.parts.some((part) => part.type === 'data-compaction')
}

function persistedSummaryPresent(
  messages: readonly TanzoUIMessage[],
  summaryId: string | undefined
): boolean {
  return messages.some((message) => {
    if (!isCompactionMarker(message)) return false
    if (!summaryId) return true
    return message.parts.some(
      (part) => part.type === 'data-compaction' && (part.data.summaryId ?? message.id) === summaryId
    )
  })
}

function mergeRunBaseMessages(
  displayMessages: readonly TanzoUIMessage[],
  baseMessages: readonly TanzoUIMessage[]
): TanzoUIMessage[] {
  if (displayMessages.length === 0) return [...baseMessages]
  const baseById = new Map(baseMessages.map((message) => [message.id, message]))
  const merged = displayMessages.map((message) => baseById.get(message.id) ?? message)
  const displayedIds = new Set(displayMessages.map((message) => message.id))
  for (const message of baseMessages) {
    if (!displayedIds.has(message.id)) merged.push(message)
  }
  return merged
}

function createChatSession(chatId: string): ChatSession & {
  open(): void
  dispose(): void
  isRunning(): boolean
  isRetained(): boolean
  lastReleasedAt(): number
} {
  const cachedMessages = queryClient.getQueryData<TanzoUIMessage[]>(chatKeys.messages(chatId))
  const hasCache = Boolean(cachedMessages && cachedMessages.length > 0)

  const transcript = createTranscriptStore(hasCache ? cachedMessages : [])
  const runState = createStateStore<RunState>(
    hasCache
      ? {
          ...INITIAL_RUN_STATE,
          isLoadingHistory: false,
          recentCompaction: latestCompaction(cachedMessages ?? [])
        }
      : INITIAL_RUN_STATE
  )
  const sidecar = createStateStore<SidecarState>(INITIAL_SIDECAR_STATE)

  let connection: RunConnection | null = null
  let sink: MessageSink | null = null
  let unsubscribeNotifications: () => void = () => {}
  let unsubscribeChanges: () => void = () => {}
  let runActive = false
  let settleRefreshRevision = 0
  let refCount = 0
  let releasedAt = Date.now()
  let opened = false
  let disposed = false

  const reconcileCompaction = (): void => {
    const inProgress = runState.getState().compactionInProgress
    if (!inProgress) return
    if (persistedSummaryPresent(transcript.getMessages(), inProgress.summaryId)) {
      runState.setState({ compactionInProgress: null })
    }
  }

  const setTranscript = (messages: readonly TanzoUIMessage[]): void => {
    transcript.replaceAll(messages)
    transcript.flushSync()
  }

  const reportError = (error: unknown): void => {
    if (disposed) return
    const code = error instanceof TanzoError ? error.code : undefined
    const message = error instanceof Error ? error.message : String(error)
    runState.update((state) => ({
      transientStatus: null,
      ...(runActive ? {} : { isStreaming: false, isStopping: false }),
      runNotice:
        state.runNotice?.kind === 'error'
          ? state.runNotice
          : {
              kind: 'error',

              error: { kind: errorKindFromCode(code), message, ...(code ? { name: code } : {}) }
            }
    }))
  }

  const restoreLastRunOutcome = async (): Promise<void> => {
    try {
      const outcome = await chatClient.lastRunOutcome(chatId)
      if (disposed || runActive || runState.getState().runNotice) return
      if (!outcome || outcome.status !== 'failed' || !outcome.error) return
      if (outcome.error.kind === 'aborted') return
      const detail = outcome.error.detail
      runState.setState({
        runNotice: {
          kind: 'error',
          stale: true,
          error: detail ?? {
            kind: errorKindFromCode(outcome.error.code),
            message: outcome.error.message ?? i18n.t('chat.runNotice.error.title'),
            ...(outcome.error.code ? { name: outcome.error.code } : {})
          }
        }
      })
    } catch {
      // Best-effort restore; a missing notice is not worth surfacing an error.
    }
  }

  const handleDataPart = (dataPart: { type: string; id?: string; data?: unknown }): void =>
    routeDataPart(dataPart, {
      setTransientStatus: (label) => runState.setState({ transientStatus: label }),
      setContextStatus: (context) => runState.setState({ contextStatus: context }),
      onCompaction: (data) => {
        if (data.stage === 'start') {
          runState.setState({ compactionInProgress: data })
          return
        }
        if (data.stage === 'failed') {
          runState.setState({ compactionInProgress: null, recentCompaction: data })
          return
        }
        runState.setState({
          compactionInProgress: persistedSummaryPresent(transcript.getMessages(), data.summaryId)
            ? null
            : data,
          recentCompaction: data
        })
        if (!runActive) {
          settleRefreshRevision += 1
          void refresh()
        }
      },
      setTasks: (tasks) => sidecar.setState({ tasks }),
      setTaskApprovals: (approvals) => sidecar.setState({ subagentApprovals: approvals }),
      setQueued: (items) => sidecar.setState({ queuedMessages: items }),
      setGoal: (goal) => sidecar.setState({ goal }),
      handleTelemetry: (event) =>
        runState.update((state) => ({ runNotice: reduceRunNotice(state.runNotice, event) }))
    })

  const startSink = (seedMessage?: TanzoUIMessage): MessageSink => {
    let active = true
    const inner = createMessageSink({
      onMessage: (message) => {
        if (!active) return
        transcript.upsert(message)
      },
      onError: reportError,
      ...(seedMessage ? { seedMessage } : {})
    })
    return {
      enqueue: (chunk) => inner.enqueue(chunk),
      close: () => {
        active = false
        inner.close()
      }
    }
  }

  const refresh = async (options?: {
    ifSettleRefreshRevision?: number
  }): Promise<TanzoUIMessage[]> => {
    try {
      const messages = await chatClient.listMessages(chatId)
      const conversation = await chatClient.getConversation(chatId)
      if (disposed) return messages
      if (
        options?.ifSettleRefreshRevision !== undefined &&
        settleRefreshRevision !== options.ifSettleRefreshRevision
      ) {
        return messages
      }
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        patchConversationSummary(list, conversation)
      )
      cacheMessages(messages)
      setTranscript(messages)
      runState.setState({ recentCompaction: latestCompaction(messages) })
      return messages
    } catch {
      return [...transcript.getMessages()]
    }
  }

  const attachRun = async (): Promise<void> => {
    let activeRunKind: ChatRunKind = 'chat'
    const nextConnection = await connectRun(chatClient, chatId, {
      persistent: true,
      onRunStart: (snapshot) => {
        runActive = true
        activeRunKind = snapshot.runKind
        settleRefreshRevision += 1
        sink?.close()
        sink = null
        if (snapshot.runKind === 'compaction') {
          const displayBaseMessages = mergeRunBaseMessages(
            transcript.getMessages(),
            snapshot.baseMessages
          )
          setTranscript(displayBaseMessages)
          runState.setState({
            isStreaming: true,
            isStopping: false,
            activeRunKind: 'compaction',
            recentCompaction: latestCompaction(displayBaseMessages)
          })
          return
        }
        const lastBase = snapshot.baseMessages.at(-1)
        sink = startSink(lastBase?.role === 'assistant' ? lastBase : undefined)
        const displayBaseMessages = mergeRunBaseMessages(
          transcript.getMessages(),
          snapshot.baseMessages
        )
        setTranscript(displayBaseMessages)
        runState.setState({
          isStreaming: true,
          isStopping: false,
          activeRunKind: 'chat',
          recentCompaction: latestCompaction(displayBaseMessages)
        })
      },
      onChunk: (chunk) => {
        if (isDataChunk(chunk)) handleDataPart(chunk)
        if (activeRunKind === 'chat') sink?.enqueue(chunk)
      },
      onSettled: async (outcome) => {
        runActive = false
        sink?.close()
        sink = null
        transcript.flushSync()
        const settledRefreshRevision = settleRefreshRevision
        await refresh({ ifSettleRefreshRevision: settledRefreshRevision })
        if (!disposed && !runActive) {
          runState.update((state) => ({
            isStreaming: false,
            isStopping: false,
            transientStatus: null,
            activeRunKind: null,

            ...(outcome?.status === 'aborted' &&
            activeRunKind === 'chat' &&
            state.runNotice?.kind !== 'error'
              ? { runNotice: { kind: 'aborted' as const } }
              : {})
          }))
        }
      },
      onError: reportError
    })
    if (disposed) nextConnection?.close()
    else connection = nextConnection
  }

  const cacheMessages = (messages: readonly TanzoUIMessage[]): void => {
    queryClient.setQueryData(chatKeys.messages(chatId), messages)
  }

  const loadHistory = async (): Promise<void> => {
    try {
      const messages = await chatClient.listMessages(chatId)
      if (!disposed) cacheMessages(messages)
      if (!disposed && !runActive) {
        setTranscript(messages)
        runState.setState({ recentCompaction: latestCompaction(messages) })
      } else if (!disposed) {
        const displayMessages = mergeRunBaseMessages(messages, transcript.getMessages())
        setTranscript(displayMessages)
        runState.setState({ recentCompaction: latestCompaction(displayMessages) })
      }
    } catch {
      // The conversation may have been deleted while opening.
    } finally {
      if (!disposed) runState.setState({ isLoadingHistory: false })
    }
  }

  const loadSidecars = async (): Promise<void> => {
    const [queued, approvals, goal, tasks] = await Promise.allSettled([
      chatClient.listQueued(chatId),
      chatClient.pendingTaskApprovals(chatId),
      goalClient.get(chatId),
      chatClient.listTasks(chatId)
    ])
    if (disposed) return
    const patch: Partial<SidecarState> = {}
    if (queued.status === 'fulfilled') patch.queuedMessages = queued.value
    if (approvals.status === 'fulfilled') patch.subagentApprovals = approvals.value
    if (goal.status === 'fulfilled') patch.goal = toGoalView(goal.value)

    if (tasks.status === 'fulfilled') patch.tasks = tasks.value
    sidecar.setState(patch)
  }

  const loadContextSnapshot = async (): Promise<void> => {
    try {
      const context = await chatClient.contextSnapshot(chatId)
      if (disposed || !context || runActive || runState.getState().contextStatus !== null) return
      runState.setState({ contextStatus: context })
    } catch {
      // The conversation may have been deleted while opening.
    }
  }

  const open = (): void => {
    if (opened || disposed) return
    opened = true
    unsubscribeChanges = transcript.subscribeChanges(() => reconcileCompaction())
    unsubscribeNotifications = chatClient.onEvent(chatId, (event) => {
      if (event.kind === 'notification') handleDataPart(event.chunk)
    })
    void loadHistory().finally(() => {
      if (!disposed) void loadContextSnapshot()
    })
    void loadSidecars()
    void attachRun()
      .catch(reportError)
      .finally(() => {
        if (!disposed && !runActive) void restoreLastRunOutcome()
      })
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    sink?.close()
    sink = null
    connection?.close()
    connection = null
    unsubscribeNotifications()
    unsubscribeChanges()
    transcript.dispose()
    runState.dispose()
    sidecar.dispose()
  }

  const goalCommand = async (args: string): Promise<string> => {
    const intent = parseGoalCommand(args)
    switch (intent.op) {
      case 'show': {
        const current = await goalClient.get(chatId)
        return current
          ? i18n.t(GOAL_COMMAND_KEYS.current, {
              objective: current.objective,
              status: deriveStatus(current)
            })
          : i18n.t(GOAL_COMMAND_KEYS.none)
      }
      case 'clear':
        await goalClient.clear(chatId)
        sidecar.setState({ goal: null })
        return i18n.t(GOAL_COMMAND_KEYS.cleared)
      case 'pause':
        sidecar.setState({ goal: toGoalView(await goalClient.setStatus(chatId, 'paused')) })
        return i18n.t(GOAL_COMMAND_KEYS.paused)
      case 'resume':
        sidecar.setState({ goal: toGoalView(await goalClient.setStatus(chatId, 'active')) })
        return i18n.t(GOAL_COMMAND_KEYS.resumed)
      case 'set': {
        const existing = await goalClient.get(chatId)
        if (existing) {
          sidecar.setState({
            goal: toGoalView(await goalClient.updateObjective(chatId, intent.objective))
          })
          return i18n.t(GOAL_COMMAND_KEYS.objectiveUpdated)
        }
        sidecar.setState({
          goal: toGoalView(await goalClient.create(chatId, { objective: intent.objective }))
        })
        return i18n.t(GOAL_COMMAND_KEYS.set)
      }
    }
  }

  return {
    chatId,
    transcript,
    runState,
    sidecar,
    open,
    dispose,
    isRunning: () => runActive,
    isRetained: () => refCount > 0,
    lastReleasedAt: () => releasedAt,
    retain() {
      if (disposed) return () => {}
      refCount += 1
      open()
      let released = false
      return () => {
        if (released) return
        released = true
        refCount -= 1
        if (refCount <= 0) releasedAt = Date.now()
      }
    },
    sendMessage(input) {
      const text = input.text.trim()
      const files = input.files ?? []
      if (!text && files.length === 0) return
      const message: TanzoUIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [...files, ...(text ? [{ type: 'text' as const, text }] : [])]
      }
      const previousMessages = [...transcript.getMessages()]
      setTranscript([...previousMessages, message])
      runState.setState({ isStreaming: true, isStopping: false, runNotice: null })
      void chatClient.submit(chatId, message).catch((error) => {
        setTranscript(previousMessages)
        reportError(error)
      })
    },
    editMessage(messageId, text) {
      const trimmed = text.trim()
      if (!trimmed) return
      const messages = transcript.getMessages()
      const targetIndex = messages.findIndex((message) => message.id === messageId)
      if (targetIndex === -1) return
      const target = messages[targetIndex]

      if (target.role !== 'user' || trailingUserMessageId(messages) !== messageId) return

      const nonTextParts = target.parts.filter((part) => part.type !== 'text')
      const edited: TanzoUIMessage = {
        ...target,
        parts: [...nonTextParts, { type: 'text' as const, text: trimmed }]
      }
      const previousMessages = [...messages]

      setTranscript([...messages.slice(0, targetIndex), edited])
      runState.setState({ isStreaming: true, isStopping: false, runNotice: null })
      void chatClient.editMessage(chatId, messageId, trimmed).catch((error) => {
        setTranscript(previousMessages)
        reportError(error)
      })
    },
    async respondApprovals(responses) {
      if (responses.length === 0) return
      const previousMessages = [...transcript.getMessages()]
      const { messages } = applyApprovalResponses(previousMessages, responses)
      setTranscript(messages)
      runState.setState({ isStreaming: true, isStopping: false, runNotice: null })
      try {
        const { started } = await chatClient.respondApprovals(chatId, responses)

        if (!started && !runActive) runState.setState({ isStreaming: false })
      } catch (error) {
        setTranscript(previousMessages)
        reportError(error)
        throw error
      }
    },
    stop() {
      const state = runState.getState()
      if (state.isStreaming && !state.isStopping) runState.setState({ isStopping: true })
      void chatClient.cancel(chatId).catch((error) => {
        if (!disposed) runState.setState({ isStopping: false })
        reportError(error)
      })
    },
    steer(text) {
      const trimmed = text.trim()

      if (trimmed) void chatClient.steer(chatId, trimmed).catch(reportError)
    },
    enqueue(text) {
      const trimmed = text.trim()
      if (trimmed) void chatClient.enqueue(chatId, trimmed).catch(reportError)
    },
    removeQueued(id) {
      void chatClient.removeQueued(chatId, id).catch(() => undefined)
    },
    retryLastTurn() {
      if (runState.getState().isStreaming) return
      runState.setState({ isStreaming: true, runNotice: null })
      void chatClient.retryTurn(chatId).catch((error) => {
        reportError(error)
      })
    },
    refresh,
    clearRunNotice() {
      if (runState.getState().runNotice) runState.setState({ runNotice: null })
    },
    async respondTaskApproval(response) {
      const rootChatId = chatId

      try {
        await chatClient.approveTask(rootChatId, response)
        sidecar.update((state) => ({
          subagentApprovals: state.subagentApprovals.filter(
            (pending) => pending.approval.approvalId !== response.approvalId
          )
        }))
      } catch (error) {
        reportError(error)
        throw error
      }
    },

    async cancelTask(taskId) {
      try {
        await chatClient.cancelTask(chatId, taskId)
      } catch (error) {
        reportError(error)
        throw error
      }
    },
    async retryTask(taskId) {
      try {
        await chatClient.retryTask(chatId, taskId)
      } catch (error) {
        reportError(error)
        throw error
      }
    },
    async steerTask(taskId, instruction) {
      try {
        const outcome = await chatClient.steerTask(chatId, taskId, instruction)
        if (!outcome.ok) {
          throw new Error(
            outcome.reason === 'terminal'
              ? 'Task already settled.'
              : outcome.reason === 'dependency-blocked'
                ? 'Task is waiting on its dependencies.'
                : 'Task not found.'
          )
        }
      } catch (error) {
        reportError(error)
        throw error
      }
    },
    goalCommand
  }
}

type ManagedSession = ReturnType<typeof createChatSession>

const MAX_IDLE_SESSIONS = 4

const sessions = new Map<string, ManagedSession>()

function evictIdleSessions(activeChatId: string): void {
  const idle: ManagedSession[] = []
  for (const session of sessions.values()) {
    if (session.chatId === activeChatId || session.isRetained() || session.isRunning()) continue
    idle.push(session)
  }
  if (idle.length <= MAX_IDLE_SESSIONS) return
  idle.sort((a, b) => a.lastReleasedAt() - b.lastReleasedAt())
  for (const session of idle.slice(0, idle.length - MAX_IDLE_SESSIONS)) {
    session.dispose()
    sessions.delete(session.chatId)
  }
}

export function getChatSession(chatId: string): ChatSession {
  const existing = sessions.get(chatId)
  if (existing) return existing
  const session = createChatSession(chatId)
  sessions.set(chatId, session)
  evictIdleSessions(chatId)
  return session
}

export function discardChatSession(chatId: string): void {
  const session = sessions.get(chatId)
  if (!session) return
  session.dispose()
  sessions.delete(chatId)
}

export function resetChatSessions(): void {
  for (const session of sessions.values()) session.dispose()
  sessions.clear()
}
