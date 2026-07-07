import { type InferUIMessageChunk } from 'ai'
import type {
  ChatEvent,
  ChatNotificationChunk,
  ChatRunError,
  ChatRunFrame,
  ChatRunKind,
  ChatRunSnapshot,
  ChatRunStateEvent,
  ChatRunStatus
} from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { ChunkSinkMeta } from './types'

interface RunSession {
  chatId: string
  runId: string
  runKind: ChatRunKind
  status: ChatRunStatus
  baseMessages: TanzoUIMessage[]

  frames: ChatRunFrame[]
  notifications: ChatNotificationChunk[]
  retainedNotice: ChatNotificationChunk | null
  nextSeq: number

  deliveredFrameCount: number

  mergeFloor: number
  tickTimer: ReturnType<typeof setTimeout> | null
}

export type RunPublishResult =
  { status: 'untracked' } | { status: 'accepted'; frame: ChatRunFrame } | { status: 'stale' }

export interface ChatRunSessionRegistry {
  start(
    chatId: string,
    runId: string,
    baseMessages: TanzoUIMessage[],
    options?: { runKind?: ChatRunKind }
  ): ChatRunStateEvent
  publish(
    chatId: string,
    chunk: InferUIMessageChunk<TanzoUIMessage>,
    meta?: ChunkSinkMeta
  ): RunPublishResult
  retainNotification(chatId: string, chunk: ChatNotificationChunk): void
  flush(chatId: string): void
  finish(
    chatId: string,
    runId: string,
    status: Exclude<ChatRunStatus, 'running'>,
    error?: ChatRunError
  ): ChatRunStateEvent | null
  snapshot(chatId: string): ChatRunSnapshot | null
}

export interface ChatRunSessionRegistryOptions {
  deliver?: (event: ChatEvent) => void
  batchMs?: number
}

const DEFAULT_TICK_MS = 33

function clone<T>(value: T): T {
  return structuredClone(value)
}

type Chunk = InferUIMessageChunk<TanzoUIMessage>

function mergeFrames(previous: ChatRunFrame, incoming: ChatRunFrame): ChatRunFrame | null {
  const prev = previous.chunk
  const next = incoming.chunk

  if (prev.type === 'text-delta' && next.type === 'text-delta' && prev.id === next.id) {
    return {
      ...incoming,
      chunk: {
        ...next,
        delta: prev.delta + next.delta,
        providerMetadata: next.providerMetadata ?? prev.providerMetadata
      }
    }
  }

  if (prev.type === 'reasoning-delta' && next.type === 'reasoning-delta' && prev.id === next.id) {
    return {
      ...incoming,
      chunk: {
        ...next,
        delta: prev.delta + next.delta,
        providerMetadata: next.providerMetadata ?? prev.providerMetadata
      }
    }
  }

  if (
    prev.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    prev.toolCallId === next.toolCallId
  ) {
    return {
      ...incoming,
      chunk: { ...next, inputTextDelta: prev.inputTextDelta + next.inputTextDelta }
    }
  }

  const prevDataId = 'id' in prev && typeof prev.id === 'string' ? prev.id : undefined
  const nextDataId = 'id' in next && typeof next.id === 'string' ? next.id : undefined
  if (prev.type.startsWith('data-') && next.type.startsWith('data-') && prevDataId === nextDataId) {
    if (!prevDataId) return null
    return incoming
  }

  return null
}

function pushStoredNotification(
  notifications: ChatNotificationChunk[],
  chunk: ChatNotificationChunk
): void {
  const id = typeof chunk.id === 'string' ? chunk.id : undefined
  if (id) {
    const index = notifications.findIndex((item) => item.id === id)
    if (index !== -1) {
      notifications[index] = chunk
      return
    }
  }
  notifications.push(chunk)
}

function stateEvent(
  chatId: string,
  runId: string,
  runKind: ChatRunKind,
  status: ChatRunStatus,
  error?: ChatRunError
): ChatRunStateEvent {
  return { kind: 'run-state', chatId, runId, runKind, status, ...(error ? { error } : {}) }
}

const RETRY_CLEARING_EVENTS = new Set([
  'operation-start',
  'operation-finish',
  'model-call-finish',
  'step-finish',
  'tool-start',
  'tool-finish',
  'chunk-summary'
])

function isTelemetryChunk(chunk: Chunk): chunk is ChatNotificationChunk {
  return typeof chunk.type === 'string' && chunk.type === 'data-telemetry'
}

function telemetryEvent(chunk: ChatNotificationChunk): string | undefined {
  const data = (chunk as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const event = (data as { event?: unknown }).event
  return typeof event === 'string' ? event : undefined
}

function telemetryHasError(chunk: ChatNotificationChunk): boolean {
  const data = (chunk as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return false
  return Boolean((data as { error?: unknown }).error)
}

function reduceRetainedNotice(
  previous: ChatNotificationChunk | null,
  chunk: ChatNotificationChunk
): ChatNotificationChunk | null {
  const event = telemetryEvent(chunk)
  if (!event) return previous
  const previousIsRetry = previous ? telemetryEvent(previous) === 'retry-attempt' : false
  if (event === 'retry-attempt') return chunk
  if (event === 'retry-exhausted' || event === 'operation-error') {
    if (telemetryHasError(chunk)) return chunk
    return previousIsRetry ? null : previous
  }
  if (RETRY_CLEARING_EVENTS.has(event)) {
    return previousIsRetry ? null : previous
  }
  return previous
}

export function createChatRunSessionRegistry(
  options: ChatRunSessionRegistryOptions = {}
): ChatRunSessionRegistry {
  const sessions = new Map<string, RunSession>()
  const tickMs = options.batchMs ?? DEFAULT_TICK_MS

  const deliver = (event: ChatEvent): void => {
    options.deliver?.(event)
  }

  const clearTick = (session: RunSession): void => {
    if (session.tickTimer) {
      clearTimeout(session.tickTimer)
      session.tickTimer = null
    }
  }

  const flushSession = (session: RunSession): void => {
    clearTick(session)
    if (!options.deliver) {
      session.deliveredFrameCount = session.frames.length
      return
    }
    const pending = session.frames.slice(session.deliveredFrameCount)
    session.deliveredFrameCount = session.frames.length
    if (pending.length === 0) return
    deliver({
      kind: 'run-frame-batch',
      chatId: session.chatId,
      runId: session.runId,
      frames: pending
    })
  }

  const flush = (chatId: string): void => {
    const session = sessions.get(chatId)
    if (session) flushSession(session)
  }

  const scheduleTick = (session: RunSession): void => {
    if (!options.deliver || session.tickTimer) return
    session.tickTimer = setTimeout(() => {
      session.tickTimer = null
      flushSession(session)
    }, tickMs)
  }

  return {
    start(chatId, runId, baseMessages, startOptions) {
      const previous = sessions.get(chatId)
      if (previous) {
        flushSession(previous)
        clearTick(previous)
        if (previous.runId !== runId && previous.status === 'running') {
          previous.status = 'aborted'
          deliver(stateEvent(chatId, previous.runId, previous.runKind, 'aborted'))
        }
      }
      const runKind = startOptions?.runKind ?? 'chat'
      sessions.set(chatId, {
        chatId,
        runId,
        runKind,
        status: 'running',
        baseMessages: clone(baseMessages),
        frames: [],
        notifications: [],
        retainedNotice: null,
        nextSeq: 1,
        deliveredFrameCount: 0,
        mergeFloor: 0,
        tickTimer: null
      })
      const event = stateEvent(chatId, runId, runKind, 'running')
      deliver(event)
      return event
    },

    publish(chatId, chunk, meta) {
      if (!meta?.runId) return { status: 'untracked' }
      const session = sessions.get(chatId)
      if (!session || session.status !== 'running') return { status: 'stale' }
      if (meta.runId !== session.runId) return { status: 'stale' }

      const frame: ChatRunFrame = {
        kind: 'run-frame',
        chatId,
        runId: session.runId,
        seq: session.nextSeq,
        chunk
      }
      session.nextSeq += 1

      const tailIndex = session.frames.length - 1
      const tail =
        tailIndex >= session.deliveredFrameCount && tailIndex >= session.mergeFloor
          ? session.frames[tailIndex]
          : undefined
      const merged = tail ? mergeFrames(tail, frame) : null
      if (merged && tail) {
        session.frames[tailIndex] = merged
      } else {
        session.frames.push(frame)
      }

      if (isTelemetryChunk(chunk)) {
        session.retainedNotice = reduceRetainedNotice(session.retainedNotice, chunk)
      }
      scheduleTick(session)
      return { status: 'accepted', frame }
    },

    retainNotification(chatId, chunk) {
      const session = sessions.get(chatId)
      if (!session || session.status !== 'running') return
      pushStoredNotification(session.notifications, chunk)
    },

    flush,

    finish(chatId, runId, status, error) {
      const session = sessions.get(chatId)
      if (!session || session.runId !== runId) return null
      flushSession(session)
      clearTick(session)
      session.status = status
      sessions.delete(chatId)
      const event = stateEvent(chatId, runId, session.runKind, status, error)
      deliver(event)
      return event
    },

    snapshot(chatId) {
      const session = sessions.get(chatId)
      if (!session || session.status !== 'running') return null

      session.mergeFloor = session.frames.length
      const notifications = [...session.notifications]
      if (session.retainedNotice) notifications.push(session.retainedNotice)
      return {
        chatId,
        runId: session.runId,
        runKind: session.runKind,
        status: 'running',
        baseMessages: session.baseMessages,
        notifications,

        frames: [...session.frames]
      }
    }
  }
}
