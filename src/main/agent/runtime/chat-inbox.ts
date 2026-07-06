import { randomUUID } from 'crypto'
import type { ChatApprovalResponse } from '@shared/chat'
import { QUEUED_MESSAGE_LIMIT } from '@shared/chat'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import { applyApprovalResponses, hasPendingApprovalRequest } from '@shared/approval-responses'
import type { QueuedMessage, TanzoUIMessage } from '@shared/agent-message'
import { fingerprint, fingerprintFieldsFor } from '../policy/engine'
import { externalizePastedTextParts } from './pasted-text'
import type { ChatKeyedQueue } from './chat-keyed-queue'
import type { AgentRuntimeDeps, Logger } from './types'

export interface ChatInbox {
  submitMessage(chatId: string, message: TanzoUIMessage): Promise<void>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  retryTurn(chatId: string): Promise<void>
  submitUserMessage(chatId: string, message: string): Promise<void>
  respondApprovals(chatId: string, responses: ChatApprovalResponse[]): Promise<{ started: boolean }>
  enqueue(chatId: string, text: string): void
  removeQueued(chatId: string, id: string): void
  publishQueue(chatId: string): void
  steer(chatId: string, text: string): void
}

export function createChatInbox(
  deps: AgentRuntimeDeps & { logger?: Logger },
  collaborators: {
    messageQueue: ChatKeyedQueue<QueuedMessage>
    steerQueue: ChatKeyedQueue<string>
  },
  callbacks: {
    isInflight(chatId: string): boolean
    runTurn(chatId: string, messages: TanzoUIMessage[]): Promise<void>
    submitUserMessage(chatId: string, text: string): Promise<void>
    instructTask(chatId: string, text: string): void
    recordPluginMentions?(chatId: string, text: string): void
  }
): ChatInbox {
  const { messageQueue, steerQueue } = collaborators

  function publishQueue(chatId: string): void {
    deps.send(chatId, {
      type: 'data-queued',
      id: `queued:${chatId}`,
      data: { items: messageQueue.list(chatId) },
      transient: true
    })
  }

  function notify(chatId: string, text: string): void {
    deps.send(chatId, {
      type: 'data-steering',
      id: randomUUID(),
      data: { text },
      transient: true
    })
  }

  function enqueue(chatId: string, text: string): void {
    // When nothing is running there is no turn-end to drain the queue, so a
    // queued message would wait forever. Dispatch it immediately instead — the
    // user's intent ("send this next") still holds when "next" is "now".
    if (!callbacks.isInflight(chatId)) {
      void callbacks.submitUserMessage(chatId, text)
      return
    }
    if (messageQueue.list(chatId).length >= QUEUED_MESSAGE_LIMIT) {
      notify(chatId, `Queue is full (max ${QUEUED_MESSAGE_LIMIT}). Message not added.`)
      return
    }
    messageQueue.push(chatId, { id: randomUUID(), text })
    publishQueue(chatId)
  }

  function removeQueued(chatId: string, id: string): void {
    const index = messageQueue.list(chatId).findIndex((item) => item.id === id)
    if (index === -1) return
    messageQueue.removeAt(chatId, index)
    publishQueue(chatId)
  }

  function steer(chatId: string, text: string): void {
    // Steering only makes sense against an in-flight run (it is injected at the
    // next prepareStep). When idle, fall back to sending the text as a normal
    // message so the user's input is never silently dropped.
    if (!callbacks.isInflight(chatId)) {
      void callbacks.submitUserMessage(chatId, text)
      return
    }
    steerQueue.push(chatId, text)
    notify(chatId, text)
  }

  function createUserMessage(text: string): TanzoUIMessage {
    return {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text }]
    }
  }

  function parentSubagentOf(chatId: string): string | null {
    const conversation = deps.store.getConversation(chatId)
    return conversation?.parentRelation === 'subagent' ? conversation.parentConversationId : null
  }

  async function routeMessages(chatId: string, messages: TanzoUIMessage[]): Promise<void> {
    const parentChatId = parentSubagentOf(chatId)
    if (parentChatId) {
      const last = messages.at(-1)
      deps.store.save(chatId, messages)
      if (last?.role === 'user') {
        const text = promptTextOf(last)
        if (text) callbacks.instructTask(chatId, text)
      }
      return
    }
    await callbacks.runTurn(chatId, messages)
  }

  function promptTextOf(message: TanzoUIMessage): string {
    return message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim()
  }

  async function submitMessage(chatId: string, message: TanzoUIMessage): Promise<void> {
    if (message.role === 'user') {
      message = await externalizePastedTextParts(message, {
        chatId,
        ...(deps.logger ? { logger: deps.logger } : {})
      })
    }
    const history = await deps.store.load(chatId)
    if (deps.hooks && history.length === 0) {
      await deps.hooks.runSessionStart({ chatId, source: 'startup' }).catch((error) => {
        deps.logger?.warn('SessionStart hook failed', { chatId, error })
      })
    }
    if (deps.hooks && message.role === 'user') {
      const prompt = promptTextOf(message)
      if (prompt) {
        const outcome = await deps.hooks
          .runUserPromptSubmit({ chatId, prompt })
          .catch((): { denied: boolean; denyReason?: string } => ({ denied: false }))
        if (outcome.denied) {
          deps.send(chatId, {
            type: 'data-steering',
            id: randomUUID(),
            data: {
              text: `Prompt blocked by hook${outcome.denyReason ? `: ${outcome.denyReason}` : ''}`
            },
            transient: true
          })
          return
        }
      }
    }
    // Record any explicit plugin @mentions so the context engine can inject a
    // focused capability hint for the upcoming turn (consumed once, at step 0).
    if (message.role === 'user') {
      callbacks.recordPluginMentions?.(chatId, promptTextOf(message))
    }
    const messages = [...history, message]
    await routeMessages(chatId, messages)
  }

  async function editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    const current = await deps.store.load(chatId)
    const targetIndex = current.findIndex((message) => message.id === messageId)
    if (targetIndex === -1) {
      throw new TanzoNotFoundError(
        'CHAT_EDIT_MESSAGE_NOT_FOUND',
        `Message "${messageId}" was not found in conversation "${chatId}".`
      )
    }

    const target = current[targetIndex]
    if (target.role !== 'user') {
      throw new TanzoValidationError(
        'CHAT_EDIT_INVALID_TARGET',
        'Only user messages can be edited.'
      )
    }
    // Synthetic context injections trail the real user message in the
    // transcript; they don't count as replies for edit eligibility.
    const isInjection = (message: TanzoUIMessage): boolean =>
      message.parts.some((part) => part.type === 'data-contextInjection')
    const lastRealIndex = (() => {
      for (let i = current.length - 1; i >= 0; i -= 1) {
        if (!isInjection(current[i])) return i
      }
      return -1
    })()
    if (targetIndex !== lastRealIndex) {
      throw new TanzoValidationError(
        'CHAT_EDIT_INVALID_TARGET',
        'Only the latest message can be edited when there is no reply below it.'
      )
    }

    const nonTextParts = target.parts.filter((part) => part.type !== 'text')
    const edited: TanzoUIMessage = {
      ...target,
      parts: [...nonTextParts, { type: 'text', text }]
    }

    await routeMessages(chatId, [...current.slice(0, targetIndex), edited])
  }

  /**
   * Resume the last turn after a failure. The full transcript is replayed:
   * steps that completed before the failure (tool calls with results, partial
   * text) were persisted per-step and stay in context, so the model continues
   * from where it stopped instead of redoing the whole turn. The turn loop
   * strips trailing incomplete tool inputs, and when the history ends with an
   * assistant message the persistence layer merges the new stream into it
   * (continuationMessageId), so the reply stays a single message in the UI.
   */
  async function retryTurn(chatId: string): Promise<void> {
    if (callbacks.isInflight(chatId)) {
      throw new TanzoValidationError(
        'CHAT_RETRY_RUN_ACTIVE',
        'Cannot retry while a run is in progress.'
      )
    }
    const current = await deps.store.load(chatId)
    const hasUserMessage = current.some((message) => message.role === 'user')
    if (!hasUserMessage) {
      throw new TanzoValidationError(
        'CHAT_RETRY_NOTHING_TO_RETRY',
        'There is no user message to retry.'
      )
    }
    await routeMessages(chatId, current)
  }

  async function submitUserMessage(chatId: string, message: string): Promise<void> {
    await submitMessage(chatId, createUserMessage(message))
  }

  async function respondApprovals(
    chatId: string,
    responses: ChatApprovalResponse[]
  ): Promise<{ started: boolean }> {
    if (responses.length === 0) return { started: false }
    const current = await deps.store.load(chatId)
    const { messages, applied } = applyApprovalResponses(current, responses)
    // Stale/duplicate responses (e.g. an approvalId already migrated by an
    // earlier rerun) apply to nothing. Report no run started so the caller can
    // reconcile its optimistic streaming state instead of waiting forever.
    if (applied.length === 0) return { started: false }
    for (const { toolName, input, response } of applied) {
      if (response.scope !== 'session' && response.scope !== 'forever') continue
      deps.policy.remember(
        {
          toolName,
          inputFingerprint: fingerprint(toolName, input, fingerprintFieldsFor(toolName)),
          decision: response.approved ? 'approved' : 'denied',
          scope: response.scope,
          decidedAt: Date.now()
        },
        chatId
      )
    }
    // Concurrent tool calls stop the turn with several approval-requested parts
    // in one assistant message. Answering them one at a time would rerun the
    // turn per response, aborting the previous run and re-emitting the remaining
    // approvals — a cascade of cards and aborts. Persist the partial decisions
    // and only rerun once every approval in the turn is resolved.
    if (hasPendingApprovalRequest(messages)) {
      if (deps.store.getConversation(chatId)) deps.store.save(chatId, messages)
      return { started: false }
    }
    await callbacks.runTurn(chatId, messages)
    return { started: true }
  }

  return {
    submitMessage,
    editMessage,
    retryTurn,
    submitUserMessage,
    respondApprovals,
    enqueue,
    removeQueued,
    publishQueue,
    steer
  }
}
