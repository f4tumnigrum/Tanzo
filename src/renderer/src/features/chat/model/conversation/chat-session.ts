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
import { deriveStatus, type ThreadGoal } from '@shared/goal'
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
import { latestCompaction, upsertMessage } from './message-utils'

type Goal = TanzoDataParts['goal']['goal']
type QueuedMessage = TanzoDataParts['queued']['items'][number]

export interface ChatSessionState {
  messages: TanzoUIMessage[]
  isLoadingHistory: boolean
  isStreaming: boolean
  /** True between the user pressing Stop and the run reaching a terminal state. */
  isStopping: boolean
  transientStatus: string | null
  contextStatus: TanzoDataParts['context'] | null
  recentCompaction: TanzoDataParts['compaction'] | null
  compactionInProgress: TanzoDataParts['compaction'] | null
  activeRunKind: ChatRunKind | null
  runNotice: RunNotice | null
  queuedMessages: QueuedMessage[]
  goal: Goal
  subagentApprovals: SubagentTaskApprovalView[]
  tasks: SubagentTask[]
}

export interface ChatSession {
  chatId: string
  subscribe(listener: () => void): () => void
  getState(): ChatSessionState
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
  goalCommand(args: string): Promise<string>
}

const TEARDOWN_DELAY_MS = 1000

const INITIAL_STATE: ChatSessionState = {
  messages: [],
  isLoadingHistory: true,
  isStreaming: false,
  isStopping: false,
  transientStatus: null,
  contextStatus: null,
  recentCompaction: null,
  compactionInProgress: null,
  activeRunKind: null,
  runNotice: null,
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

function reconcileCompactionInProgress(
  messages: readonly TanzoUIMessage[],
  inProgress: TanzoDataParts['compaction'] | null
): TanzoDataParts['compaction'] | null {
  if (!inProgress) return null
  return persistedSummaryPresent(messages, inProgress.summaryId) ? null : inProgress
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

function createChatSession(chatId: string, onDispose: () => void): ChatSession {
  const cachedMessages = queryClient.getQueryData<TanzoUIMessage[]>(chatKeys.messages(chatId))
  let state: ChatSessionState =
    cachedMessages && cachedMessages.length > 0
      ? {
          ...INITIAL_STATE,
          messages: cachedMessages,
          isLoadingHistory: false,
          recentCompaction: latestCompaction(cachedMessages)
        }
      : INITIAL_STATE
  const listeners = new Set<() => void>()
  let connection: RunConnection | null = null
  let sink: MessageSink | null = null
  let unsubscribeNotifications: () => void = () => {}
  let runActive = false
  let settleRefreshRevision = 0
  let refCount = 0
  let teardownTimer: ReturnType<typeof setTimeout> | null = null
  let opened = false
  let disposed = false

  const setState = (patch: Partial<ChatSessionState>): void => {
    const next = { ...state, ...patch }
    if ('messages' in patch) {
      next.compactionInProgress = reconcileCompactionInProgress(
        next.messages,
        next.compactionInProgress
      )
    }
    state = next
    for (const listener of listeners) listener()
  }

  const reportError = (error: unknown): void => {
    if (disposed) return
    const code = error instanceof TanzoError ? error.code : undefined
    const message = error instanceof Error ? error.message : String(error)
    setState({
      transientStatus: null,
      ...(runActive ? {} : { isStreaming: false, isStopping: false }),
      runNotice:
        state.runNotice?.kind === 'error'
          ? state.runNotice
          : {
              kind: 'error',
              // Recover the error category from the ChatRunError code so the
              // degraded (non-telemetry) path still shows an accurate heading.
              error: { kind: errorKindFromCode(code), message, ...(code ? { name: code } : {}) }
            }
    })
  }

  /**
   * Restore the last failed run's notice from the persisted runs table so a
   * failure survives session teardown, chat switches, and app restarts. Only
   * fills the slot when the failed run is the tail of the conversation (no
   * user activity after it) and no live notice exists.
   */
  const restoreLastRunOutcome = async (): Promise<void> => {
    try {
      const outcome = await chatClient.lastRunOutcome(chatId)
      if (disposed || runActive || state.runNotice) return
      if (!outcome || outcome.status !== 'failed' || !outcome.error) return
      if (outcome.error.kind === 'aborted') return
      const detail = outcome.error.detail
      setState({
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
      setTransientStatus: (label) => setState({ transientStatus: label }),
      setContextStatus: (context) => setState({ contextStatus: context }),
      onCompaction: (data) => {
        if (data.stage === 'start') {
          setState({ compactionInProgress: data })
          return
        }
        if (data.stage === 'failed') {
          setState({ compactionInProgress: null, recentCompaction: data })
          return
        }
        setState({
          compactionInProgress: persistedSummaryPresent(state.messages, data.summaryId)
            ? null
            : data,
          recentCompaction: data
        })
        if (!runActive) {
          settleRefreshRevision += 1
          void refresh()
        }
      },
      setTasks: (tasks) => setState({ tasks }),
      setTaskApprovals: (approvals) => setState({ subagentApprovals: approvals }),
      setQueued: (items) => setState({ queuedMessages: items }),
      setGoal: (goal) => setState({ goal }),
      handleTelemetry: (event) => setState({ runNotice: reduceRunNotice(state.runNotice, event) })
    })

  const startSink = (seedMessage?: TanzoUIMessage): MessageSink => {
    let active = true
    const inner = createMessageSink({
      onMessage: (message) => {
        if (!active) return
        setState({ messages: upsertMessage(state.messages, message) })
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
      setState({
        messages,
        recentCompaction: latestCompaction(messages)
      })
      return messages
    } catch {
      return state.messages
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
          const displayBaseMessages = mergeRunBaseMessages(state.messages, snapshot.baseMessages)
          setState({
            messages: displayBaseMessages,
            isStreaming: true,
            isStopping: false,
            activeRunKind: 'compaction',
            recentCompaction: latestCompaction(displayBaseMessages)
          })
          return
        }
        const lastBase = snapshot.baseMessages.at(-1)
        sink = startSink(lastBase?.role === 'assistant' ? lastBase : undefined)
        const displayBaseMessages = mergeRunBaseMessages(state.messages, snapshot.baseMessages)
        setState({
          messages: displayBaseMessages,
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
        const settledRefreshRevision = settleRefreshRevision
        await refresh({ ifSettleRefreshRevision: settledRefreshRevision })
        if (!disposed && !runActive) {
          setState({
            isStreaming: false,
            isStopping: false,
            transientStatus: null,
            activeRunKind: null,
            // Surface an explicit "stopped" marker so a user-cancelled run is
            // distinguishable from a naturally finished one. Only for chat
            // runs (internal compaction aborts are not user-facing) and never
            // overwriting an error notice (an abort racing a failure keeps
            // the error).
            ...(outcome?.status === 'aborted' &&
            activeRunKind === 'chat' &&
            state.runNotice?.kind !== 'error'
              ? { runNotice: { kind: 'aborted' as const } }
              : {})
          })
        }
      },
      onError: reportError
    })
    if (disposed) nextConnection?.close()
    else connection = nextConnection
  }

  const cacheMessages = (messages: TanzoUIMessage[]): void => {
    queryClient.setQueryData(chatKeys.messages(chatId), messages)
  }

  const loadHistory = async (): Promise<void> => {
    try {
      const messages = await chatClient.listMessages(chatId)
      if (!disposed) cacheMessages(messages)
      if (!disposed && !runActive) {
        setState({ messages, recentCompaction: latestCompaction(messages) })
      } else if (!disposed) {
        const displayMessages = mergeRunBaseMessages(messages, state.messages)
        setState({ messages: displayMessages, recentCompaction: latestCompaction(displayMessages) })
      }
    } catch {
      // The conversation may have been deleted while opening.
    } finally {
      if (!disposed) setState({ isLoadingHistory: false })
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
    const patch: Partial<ChatSessionState> = {}
    if (queued.status === 'fulfilled') patch.queuedMessages = queued.value
    if (approvals.status === 'fulfilled') patch.subagentApprovals = approvals.value
    if (goal.status === 'fulfilled') patch.goal = toGoalView(goal.value)
    // Load historical sub-agent tasks so the header pill stays resident for any
    // conversation that has spawned sub-agents, even when none are running.
    if (tasks.status === 'fulfilled') patch.tasks = tasks.value
    setState(patch)
  }

  const loadContextSnapshot = async (): Promise<void> => {
    try {
      const context = await chatClient.contextSnapshot(chatId)
      if (disposed || !context || runActive || state.contextStatus !== null) return
      setState({ contextStatus: context })
    } catch {
      // The conversation may have been deleted while opening.
    }
  }

  const open = (): void => {
    if (opened || disposed) return
    opened = true
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
        // After the run attach settles we know whether a run is live; only
        // then can a persisted failure be restored without racing a stream.
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
    listeners.clear()
    onDispose()
  }

  const goalCommand = async (args: string): Promise<string> => {
    const trimmed = args.trim()
    const lower = trimmed.toLowerCase()
    if (!trimmed) {
      const current = await goalClient.get(chatId)
      return current
        ? i18n.t('chat.goal.command.current', {
            objective: current.objective,
            status: deriveStatus(current)
          })
        : i18n.t('chat.goal.command.none')
    }
    if (lower === 'clear') {
      await goalClient.clear(chatId)
      setState({ goal: null })
      return i18n.t('chat.goal.command.cleared')
    }
    if (lower === 'pause') {
      setState({ goal: toGoalView(await goalClient.setStatus(chatId, 'paused')) })
      return i18n.t('chat.goal.command.paused')
    }
    if (lower === 'resume') {
      setState({ goal: toGoalView(await goalClient.setStatus(chatId, 'active')) })
      return i18n.t('chat.goal.command.resumed')
    }
    const existing = await goalClient.get(chatId)
    if (existing) {
      setState({ goal: toGoalView(await goalClient.updateObjective(chatId, trimmed)) })
      return i18n.t('chat.goal.command.objectiveUpdated')
    }
    setState({ goal: toGoalView(await goalClient.create(chatId, { objective: trimmed })) })
    return i18n.t('chat.goal.command.set')
  }

  teardownTimer = setTimeout(dispose, TEARDOWN_DELAY_MS)

  return {
    chatId,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    retain() {
      if (disposed) return () => {}
      refCount += 1
      if (teardownTimer) {
        clearTimeout(teardownTimer)
        teardownTimer = null
      }
      open()
      let released = false
      return () => {
        if (released) return
        released = true
        refCount -= 1
        if (refCount > 0) return
        teardownTimer = setTimeout(dispose, TEARDOWN_DELAY_MS)
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
      const previousMessages = state.messages
      setState({
        messages: [...state.messages, message],
        isStreaming: true,
        isStopping: false,
        runNotice: null
      })
      void chatClient.submit(chatId, message).catch((error) => {
        setState({ messages: previousMessages })
        reportError(error)
      })
    },
    editMessage(messageId, text) {
      const trimmed = text.trim()
      if (!trimmed) return
      const targetIndex = state.messages.findIndex((message) => message.id === messageId)
      if (targetIndex === -1) return
      const target = state.messages[targetIndex]
      if (target.role !== 'user' || targetIndex !== state.messages.length - 1) return

      const nonTextParts = target.parts.filter((part) => part.type !== 'text')
      const edited: TanzoUIMessage = {
        ...target,
        parts: [...nonTextParts, { type: 'text' as const, text: trimmed }]
      }
      const previousMessages = state.messages
      setState({
        messages: [...state.messages.slice(0, targetIndex), edited],
        isStreaming: true,
        isStopping: false,
        runNotice: null
      })
      void chatClient.editMessage(chatId, messageId, trimmed).catch((error) => {
        setState({ messages: previousMessages })
        reportError(error)
      })
    },
    async respondApprovals(responses) {
      if (responses.length === 0) return
      const previousMessages = state.messages
      const { messages } = applyApprovalResponses(state.messages, responses)
      setState({ messages, isStreaming: true, isStopping: false, runNotice: null })
      try {
        const { started } = await chatClient.respondApprovals(chatId, responses)
        // No run was launched — either approvals are still pending in this turn
        // or the responses were stale. Clear the optimistic streaming flag so the
        // UI never sticks waiting for a stream that will never start.
        if (!started && !runActive) setState({ isStreaming: false })
      } catch (error) {
        setState({ messages: previousMessages })
        reportError(error)
        throw error
      }
    },
    stop() {
      // Reflect the in-flight cancel immediately; the terminal run-state event
      // clears it. If the cancel IPC itself fails, roll back and surface the
      // failure instead of silently leaving a phantom "stopping" state.
      if (state.isStreaming && !state.isStopping) setState({ isStopping: true })
      void chatClient.cancel(chatId).catch((error) => {
        if (!disposed) setState({ isStopping: false })
        reportError(error)
      })
    },
    steer(text) {
      const trimmed = text.trim()
      // A failed steer/enqueue silently discards the user's text; surface it.
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
      if (state.isStreaming) return
      setState({ isStreaming: true, runNotice: null })
      void chatClient.retryTurn(chatId).catch((error) => {
        reportError(error)
      })
    },
    refresh,
    clearRunNotice() {
      if (state.runNotice) setState({ runNotice: null })
    },
    async respondTaskApproval(response) {
      const rootChatId = chatId
      // Confirm the approval with the main process BEFORE removing the card.
      // Previously the card was removed optimistically first; if the IPC call
      // failed, the card was already unmounted and the task was permanently stuck
      // in blocked state with no way to re-respond.
      try {
        await chatClient.approveTask(rootChatId, response)
        setState({
          subagentApprovals: state.subagentApprovals.filter(
            (pending) => pending.approval.approvalId !== response.approvalId
          )
        })
      } catch (error) {
        reportError(error)
        throw error
      }
    },
    goalCommand
  }
}

const sessions = new Map<string, ChatSession>()

export function getChatSession(chatId: string): ChatSession {
  const existing = sessions.get(chatId)
  if (existing) return existing
  const session = createChatSession(chatId, () => {
    if (sessions.get(chatId) === session) sessions.delete(chatId)
  })
  sessions.set(chatId, session)
  return session
}
