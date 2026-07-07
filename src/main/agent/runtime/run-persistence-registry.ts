import type { TanzoUIMessage } from '@shared/agent-message'
import type { AgentDefinition } from '../agents/types'
import type { ContextEngine } from '../context'
import type { AgentStore } from '../store-types'
import type { ChunkSink, Logger } from './types'

export interface ChatRunPersistenceContext {
  def: AgentDefinition
  broadcast: boolean
  canPersist(): boolean
  canPersistFinal?(): boolean
  store: Pick<AgentStore, 'save' | 'loadUnvalidated'>
  send: ChunkSink
  contextEngine?: Pick<ContextEngine, 'snapshot'>
  logger?: Pick<Logger, 'warn'>
}

interface ConsumedSteer {
  message: TanzoUIMessage

  stepNumber: number
}

interface RunPersistenceSession {
  chatId: string
  runId: string
  baseMessages: TanzoUIMessage[]
  consumedSteers: ConsumedSteer[]
  context: ChatRunPersistenceContext

  persistedView: TanzoUIMessage[] | null
}

export interface ChatRunPersistenceRegistry {
  start(
    chatId: string,
    runId: string,
    baseMessages: TanzoUIMessage[],
    context: ChatRunPersistenceContext
  ): void
  addConsumedSteering(
    chatId: string,
    runId: string,
    messages: TanzoUIMessage[],
    stepNumber?: number
  ): void
  persistStepMessages(chatId: string, runId: string, messages: TanzoUIMessage[]): Promise<boolean>
  persistFinalMessages(
    chatId: string,
    runId: string,
    messages: TanzoUIMessage[],
    options: { streamFailed: boolean }
  ): Promise<boolean>
  finish(chatId: string, runId: string): void
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function continuationMessageId(session: RunPersistenceSession): string | undefined {
  const lastBase = session.baseMessages.at(-1)
  return lastBase?.role === 'assistant' ? lastBase.id : undefined
}

function mergeGeneratedMessages(
  session: RunPersistenceSession,
  current: readonly TanzoUIMessage[],
  incoming: readonly TanzoUIMessage[]
): TanzoUIMessage[] {
  const continuationId = continuationMessageId(session)
  const baseIds = new Set(session.baseMessages.map((message) => message.id))
  const isGenerated = (message: TanzoUIMessage): boolean =>
    !baseIds.has(message.id) || message.id === continuationId
  const generatedById = new Map(
    incoming.filter(isGenerated).map((message) => [message.id, message])
  )
  const currentIds = new Set(current.map((message) => message.id))
  const result = current.map((message) => generatedById.get(message.id) ?? message)

  for (const message of incoming) {
    if (!isGenerated(message) || currentIds.has(message.id)) continue
    const incomingIndex = incoming.indexOf(message)
    let anchorAt = result.length
    for (let j = incomingIndex + 1; j < incoming.length; j += 1) {
      const at = result.findIndex((existing) => existing.id === incoming[j].id)
      if (at !== -1) {
        anchorAt = at
        break
      }
    }
    result.splice(anchorAt, 0, message)
    currentIds.add(message.id)
  }
  return result
}

function persistableMessages(messages: TanzoUIMessage[]): TanzoUIMessage[] {
  return messages.filter((message) => message.parts.length > 0)
}

function withConsumedSteering(
  session: RunPersistenceSession,
  messages: TanzoUIMessage[]
): TanzoUIMessage[] {
  if (session.consumedSteers.length === 0) return messages
  const existingIds = new Set(messages.map((message) => message.id))
  const missingSteers = session.consumedSteers.filter((steer) => !existingIds.has(steer.message.id))
  if (missingSteers.length === 0) return messages
  const continuationId = continuationMessageId(session)
  const originalIds = new Set(
    session.baseMessages.map((message) => message.id).filter((id) => id !== continuationId)
  )

  const result = [...messages]
  const hasStepMetadata = result.some(
    (message) =>
      !originalIds.has(message.id) &&
      message.role === 'assistant' &&
      typeof message.metadata?.steps?.[0]?.stepNumber === 'number'
  )
  const firstGeneratedBoundary = (): number => {
    let at = 0
    while (at < result.length && originalIds.has(result[at].id)) at += 1
    return at
  }
  const insertionIndex = (steer: ConsumedSteer): number => {
    if (!hasStepMetadata) return firstGeneratedBoundary()
    for (let i = 0; i < result.length; i += 1) {
      const message = result[i]
      if (originalIds.has(message.id) || message.role !== 'assistant') continue
      const stepNumber = message.metadata?.steps?.[0]?.stepNumber
      if (typeof stepNumber === 'number' && stepNumber >= steer.stepNumber + 1) return i
    }

    return steer.stepNumber === 0 ? firstGeneratedBoundary() : result.length
  }
  for (const steer of missingSteers) {
    result.splice(insertionIndex(steer), 0, steer.message)
  }
  return result
}

async function publishContextSnapshot(
  session: RunPersistenceSession,
  messages: TanzoUIMessage[]
): Promise<void> {
  const { context } = session
  if (!context.broadcast || !context.contextEngine) return
  try {
    context.send(
      session.chatId,
      {
        type: 'data-context',
        id: `context:${session.chatId}`,
        data: context.contextEngine.snapshot(context.def, session.chatId, messages),
        transient: true
      },
      { runId: session.runId }
    )
  } catch (error) {
    context.logger?.warn('context snapshot publish failed', { chatId: session.chatId, error })
  }
}

async function persistRunMessages(
  session: RunPersistenceSession,
  messages: TanzoUIMessage[],
  options: {
    streamFailed?: boolean
    allowAfterFailure?: boolean
    isFinal?: boolean
    publishContext?: boolean
  } = {}
): Promise<boolean> {
  const { context } = session
  if (options.streamFailed && !options.allowAfterFailure) return false
  const allowed = options.isFinal
    ? (context.canPersistFinal ?? context.canPersist)()
    : context.canPersist()
  if (!allowed) return false
  const incoming = persistableMessages(withConsumedSteering(session, messages))
  if (incoming.length === 0) return false

  const current = session.persistedView ?? context.store.loadUnvalidated(session.chatId)
  const persisted = mergeGeneratedMessages(session, current, incoming)
  context.store.save(session.chatId, persisted)
  session.persistedView = persisted
  if (options.publishContext) await publishContextSnapshot(session, persisted)
  return true
}

export function createChatRunPersistenceRegistry(): ChatRunPersistenceRegistry {
  const sessions = new Map<string, RunPersistenceSession>()

  const matchingSession = (chatId: string, runId: string): RunPersistenceSession | null => {
    const session = sessions.get(chatId)
    if (!session || session.runId !== runId) return null
    return session
  }

  return {
    start(chatId, runId, baseMessages, context) {
      sessions.set(chatId, {
        chatId,
        runId,
        baseMessages: clone(baseMessages),
        consumedSteers: [],
        context,
        persistedView: null
      })
    },

    addConsumedSteering(chatId, runId, messages, stepNumber = 0) {
      const session = matchingSession(chatId, runId)
      if (!session) return
      session.consumedSteers.push(...clone(messages).map((message) => ({ message, stepNumber })))
    },

    persistStepMessages(chatId, runId, messages) {
      const session = matchingSession(chatId, runId)
      if (!session) return Promise.resolve(false)
      return persistRunMessages(session, messages, {
        publishContext: true
      })
    },

    persistFinalMessages(chatId, runId, messages, { streamFailed }) {
      const session = matchingSession(chatId, runId)
      if (!session) return Promise.resolve(false)
      return persistRunMessages(session, messages, {
        streamFailed,
        allowAfterFailure: true,
        isFinal: true,
        publishContext: !streamFailed
      })
    },

    finish(chatId, runId) {
      const session = sessions.get(chatId)
      if (session?.runId === runId) sessions.delete(chatId)
    }
  }
}
