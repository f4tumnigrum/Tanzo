import { randomUUID } from 'crypto'
import type { ContextEngine } from './context'
import { convertToModelMessages } from 'ai'
import type { QueuedMessage, TanzoDataParts } from '@shared/agent-message'
import { createCompactionCoordinator } from './runtime/compaction-coordinator'
import { createRunEngine } from './runtime/run-engine'
import { createChatInbox } from './runtime/chat-inbox'
import { createChatKeyedQueue } from './runtime/chat-keyed-queue'
import { createChatMailbox } from './runtime/chat-mailbox'
import { createChatRunPersistenceRegistry } from './runtime/run-persistence-registry'
import { createTurnFinalizer } from './runtime/turn-finalizer'
import { createTurnLoop } from './runtime/turn-loop'
import { createTaskService } from './subagent/task-service'
import { createQuestionBroker } from './question/broker'
import type {
  AgentRuntimeDeps,
  AgentService,
  GoalRuntime,
  HookLifecycle,
  Logger
} from './runtime/types'
import type { ChatRunSessionRegistry } from './runtime/run-session-registry'
import type { SkillsStore } from './skills/types'
import type { ChangeSetService } from './git/change-set-service'
import type { QuestionBroker } from './question/broker'

export type AgentServiceDeps = AgentRuntimeDeps & {
  skills?: SkillsStore
  logger?: Logger
  contextEngine?: ContextEngine
  goal?: GoalRuntime
  streams?: Pick<ChatRunSessionRegistry, 'start' | 'finish'>
  changeSet?: ChangeSetService
  questions?: QuestionBroker
  hooks?: HookLifecycle
  recordPluginMentions?: (chatId: string, text: string) => void
}

export function createAgentService(deps: AgentServiceDeps): AgentService {
  const engine = createRunEngine({
    ...(deps.streams ? { streams: deps.streams } : {}),
    ...(deps.logger ? { logger: deps.logger } : {})
  })

  const steerQueue = createChatKeyedQueue<string>()
  const messageQueue = createChatKeyedQueue<QueuedMessage>({
    onChange: (chatId, items) => {
      try {
        // Persist only ordered text; the `id` is a transient UI handle.
        deps.store.saveQueuedMessages(
          chatId,
          items.map((item) => item.text)
        )
      } catch (error) {
        deps.logger?.warn('failed to persist queued messages', { chatId, error })
      }
    }
  })
  for (const { chatId, items } of deps.store.listAllQueuedMessages()) {
    for (const text of items) messageQueue.push(chatId, { id: randomUUID(), text })
  }
  const mailbox = createChatMailbox()
  const runPersistence = createChatRunPersistenceRegistry()

  const isInflight = (chatId: string): boolean => engine.isRunning(chatId)

  function clearTransientChatState(chatId: string): void {
    steerQueue.clear(chatId)
    questionBroker.clearForChat(chatId)
  }

  const compaction = createCompactionCoordinator({
    ...deps,
    runLifecycle: (chatId, runId, baseMessages, executor, parentSignal) =>
      engine.run(
        {
          chatId,
          runId,
          kind: 'compaction',
          baseMessages,
          ...(parentSignal ? { parentSignal } : {})
        },
        (handle) => executor(handle.signal)
      )
  })

  const questionBroker = deps.questions ?? createQuestionBroker()

  const submitUserMessageQueued = (chatId: string, message: string): Promise<void> =>
    mailbox.enqueue(chatId, () => inbox.submitUserMessage(chatId, message))

  const startGoalContinuationQueued = (chatId: string): Promise<void> => {
    const scheduledGeneration = engine.currentCancelGeneration(chatId)
    return mailbox.enqueue(chatId, () =>
      turnLoop.startGoalContinuation(chatId, scheduledGeneration)
    )
  }

  const turnFinalizer = createTurnFinalizer(
    deps,
    { steerQueue, messageQueue },
    {
      isInflight,
      submitUserMessage: submitUserMessageQueued,
      startGoalContinuation: startGoalContinuationQueued,
      publishQueue: (chatId) => inbox.publishQueue(chatId)
    }
  )

  const turnLoop = createTurnLoop(deps, {
    engine,
    runPersistence,
    compaction,
    turnFinalizer,
    steerQueue
  })

  const tasks = createTaskService(
    deps,
    { compaction, policy: deps.policy },
    {
      abortRun: (chatId) => engine.abort(chatId),
      clearTransientChatState,
      currentRunEpoch: (chatId) => engine.currentEpoch(chatId),
      hasAdvancedSince: engine.hasAdvancedSince,
      isInflight,
      startChatRun: turnLoop.startChatRun
    }
  )
  const reconciledTasks = tasks.reconcileOrphans()
  if (reconciledTasks > 0) {
    deps.logger?.info?.('failed orphaned sub-agent tasks on startup', { count: reconciledTasks })
  }

  const inbox = createChatInbox(
    deps,
    { messageQueue, steerQueue },
    {
      isInflight,
      runTurn: turnLoop.run,
      submitUserMessage: submitUserMessageQueued,
      instructTask: (chatId, text) => {
        void text
        tasks.resumeByChat(chatId)
      },
      ...(deps.recordPluginMentions ? { recordPluginMentions: deps.recordPluginMentions } : {})
    }
  )

  function cancel(chatId: string): void {
    engine.bumpCancelGeneration(chatId)
    engine.abort(chatId)
    turnLoop.discardPendingChangeCapture(chatId)
    clearTransientChatState(chatId)
    tasks.cancelTree(chatId)
  }

  function deleteConversation(chatId: string): void {
    cancel(chatId)
    messageQueue.clear(chatId)
    deps.store.deleteConversation(chatId)
  }

  function deleteWorkspace(workspaceId: string): void {
    const chatIds = new Set<string>()
    for (const conversation of deps.store.listConversations()) {
      if (conversation.workspaceId === workspaceId) chatIds.add(conversation.id)
    }
    for (const chatId of engine.listRunning()) {
      if (deps.store.getConversation(chatId)?.workspaceId === workspaceId) chatIds.add(chatId)
    }
    for (const queued of deps.store.listAllQueuedMessages()) {
      if (deps.store.getConversation(queued.chatId)?.workspaceId === workspaceId) {
        chatIds.add(queued.chatId)
      }
    }
    for (const chatId of chatIds) {
      cancel(chatId)
      messageQueue.clear(chatId)
    }
    deps.store.deleteWorkspace(workspaceId)
  }

  async function contextSnapshot(chatId: string): Promise<TanzoDataParts['context'] | null> {
    const engine = deps.contextEngine
    if (!engine) return null
    if (!deps.store.getConversation(chatId)) return null
    try {
      const def = await deps.store.resolveAgentDefinition(chatId)
      const messages = await deps.store.load(chatId)
      const modelMessages = await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true
      })
      return engine.snapshot(def, chatId, modelMessages)
    } catch (error) {
      deps.logger?.warn('context snapshot computation failed', { chatId, error })
      return null
    }
  }

  async function lastAssistantText(chatId: string): Promise<string | null> {
    const lastAssistant = (await deps.store.load(chatId))
      .filter((message) => message.role === 'assistant')
      .at(-1)
    return (
      lastAssistant?.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim() ?? null
    )
  }

  async function runWithStopHook(
    chatId: string,
    incoming: Parameters<typeof turnLoop.run>[1]
  ): Promise<void> {
    await turnLoop.run(chatId, incoming)
    if (!deps.hooks) return

    const outcome = await deps.hooks
      .runStop({
        chatId,
        stopHookActive: false,
        lastAssistantMessage: await lastAssistantText(chatId)
      })
      .catch(() => null)
    if (!outcome?.stopped && !outcome?.feedback?.length) return

    await turnLoop.run(chatId, await deps.store.load(chatId))
    await deps.hooks
      .runStop({
        chatId,
        stopHookActive: true,
        lastAssistantMessage: await lastAssistantText(chatId)
      })
      .catch(() => {})
  }

  return {
    run: (chatId, incoming) => mailbox.enqueue(chatId, () => runWithStopHook(chatId, incoming)),
    cancel,
    steer: inbox.steer,
    startGoalContinuation: startGoalContinuationQueued,
    enqueue: inbox.enqueue,
    removeQueued: inbox.removeQueued,
    listQueued: messageQueue.list,
    listRunning: () => engine.listRunning(),
    isRunning: isInflight,
    settleRuns: (timeoutMs) => engine.settle(timeoutMs),
    deleteWorkspace,
    deleteConversation,
    submitUserMessage: submitUserMessageQueued,
    submitMessage: (chatId, message) =>
      mailbox.enqueue(chatId, () => inbox.submitMessage(chatId, message)),
    editMessage: (chatId, messageId, text) =>
      mailbox.enqueue(chatId, () => inbox.editMessage(chatId, messageId, text)),
    respondApprovals: (chatId, responses) =>
      mailbox.enqueue(chatId, () => inbox.respondApprovals(chatId, responses)),
    compact: (chatId, options) =>
      mailbox.enqueue(chatId, () => compaction.compact(chatId, options)),
    contextSnapshot,
    spawnTask: (input) => tasks.spawn(input),
    awaitTask: (rootChatId, taskId, signal) => tasks.await(rootChatId, taskId, signal),
    getTask: (rootChatId, taskId) => tasks.get(rootChatId, taskId),
    listTasks: (rootChatId, status) => tasks.list(rootChatId, status),
    instructTask: (rootChatId, taskId, instruction) =>
      tasks.instruct(rootChatId, taskId, instruction),
    redefineTask: (rootChatId, taskId, objective) => tasks.redefine(rootChatId, taskId, objective),
    cancelTask: (rootChatId, taskId) => tasks.cancel(rootChatId, taskId),
    retryTask: (rootChatId, taskId) => tasks.retry(rootChatId, taskId),
    reportTaskPhase: (chatId, phase) => tasks.reportPhase(chatId, phase),
    submitTaskResult: (chatId, result) => tasks.submitResult(chatId, result),
    respondTaskApproval: (rootChatId, response) => tasks.respondApproval(rootChatId, response),
    listTaskApprovals: (rootChatId) => tasks.listApprovals(rootChatId),
    answerQuestion: (response) =>
      questionBroker.respond(
        response.chatId,
        response.questionId,
        response.declined
          ? { kind: 'declined', ...(response.note ? { note: response.note } : {}) }
          : { kind: 'answers', answers: response.answers }
      )
  }
}
