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
  notifications: ChatNotificationChunk[]
  frames: ChatRunFrame[]
  retainedNotice: ChatNotificationChunk | null
  nextSeq: number
}

export type RunPublishResult =
  | { status: 'untracked' }
  | { status: 'accepted'; frame: ChatRunFrame }
  | { status: 'stale' }

/**
 * Renderer-facing projection of the run lifecycle. This registry is the single
 * authority for a broadcastable {@link ChatRunStatus} and the frame buffer that
 * a reconnecting renderer replays via {@link ChatRunSessionRegistry.snapshot}.
 *
 * Coordination invariant (kept by call-ordering, not by a shared type — see
 * `turn-loop.ts` `startChatRun`/`run` and `run-engine.ts` `run`):
 *
 *   - For any (chatId, runId) there is exactly one `start` and exactly one
 *     terminal `finish`. `start` is driven from `run-engine.run` via its
 *     `streams.start` hook; the terminal `finish` is driven by `run-engine.run`'s
 *     `finally` for non-deferred runs, and by `turn-loop.run`'s `finally`
 *     (pendingTerminal / retry paths) for `deferTerminal` runs.
 *   - `finish` DELETES the session, so every subsequent finish for the same
 *     runId is an idempotent no-op returning null. The multiple finish paths for
 *     deferred runs rely on this: first writer wins, the rest short-circuit on a
 *     missing/mismatched runId. Do not change `finish` to resurrect or retain a
 *     finished session without revisiting that choreography.
 *   - This registry keys everything on `runId`; the RunEngine never does (it
 *     keys on AbortController identity + epoch). A newer `start` supersedes an
 *     older still-`running` session by emitting a synthetic `aborted` terminal.
 *   - The persistence registry (`run-persistence-registry.ts`) brackets the same
 *     runId but owns NO status: it derives write permission from engine closures
 *     (`handle.isCurrent()`, `handle.signal.aborted`) and so cannot contradict
 *     the status broadcast from here.
 */
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

const DEFAULT_DELTA_BATCH_MS = 24

function clone<T>(value: T): T {
  return structuredClone(value)
}

function mergeStoredFrame(previous: ChatRunFrame, incoming: ChatRunFrame): boolean {
  const prev = previous.chunk
  const next = incoming.chunk

  if (prev.type === 'text-delta' && next.type === 'text-delta' && prev.id === next.id) {
    previous.seq = incoming.seq
    previous.chunk = {
      ...next,
      delta: prev.delta + next.delta,
      providerMetadata: next.providerMetadata ?? prev.providerMetadata
    }
    return true
  }

  if (prev.type === 'reasoning-delta' && next.type === 'reasoning-delta' && prev.id === next.id) {
    previous.seq = incoming.seq
    previous.chunk = {
      ...next,
      delta: prev.delta + next.delta,
      providerMetadata: next.providerMetadata ?? prev.providerMetadata
    }
    return true
  }

  if (
    prev.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    prev.toolCallId === next.toolCallId
  ) {
    previous.seq = incoming.seq
    previous.chunk = {
      ...next,
      inputTextDelta: prev.inputTextDelta + next.inputTextDelta
    }
    return true
  }

  const prevDataId = 'id' in prev && typeof prev.id === 'string' ? prev.id : undefined
  const nextDataId = 'id' in next && typeof next.id === 'string' ? next.id : undefined
  if (prev.type.startsWith('data-') && next.type.startsWith('data-') && prevDataId === nextDataId) {
    if (!prevDataId) return false
    previous.seq = incoming.seq
    previous.chunk = clone(next)
    return true
  }

  return false
}

function pushStoredNotification(
  notifications: ChatNotificationChunk[],
  chunk: ChatNotificationChunk
): void {
  const id = typeof chunk.id === 'string' ? chunk.id : undefined
  if (id) {
    const index = notifications.findIndex((item) => item.id === id)
    if (index !== -1) {
      notifications[index] = clone(chunk)
      return
    }
  }
  notifications.push(clone(chunk))
}

function pushStoredFrame(frames: ChatRunFrame[], frame: ChatRunFrame): void {
  const previous = frames.at(-1)
  if (previous && mergeStoredFrame(previous, frame)) return
  frames.push(clone(frame))
}

function isMergeableLiveFrame(frame: ChatRunFrame): boolean {
  return (
    frame.chunk.type === 'text-delta' ||
    frame.chunk.type === 'reasoning-delta' ||
    frame.chunk.type === 'tool-input-delta'
  )
}

function canMergeLiveFrames(previous: ChatRunFrame, incoming: ChatRunFrame): boolean {
  if (previous.runId !== incoming.runId) return false
  const prev = previous.chunk
  const next = incoming.chunk
  if (prev.type === 'text-delta' && next.type === 'text-delta') return prev.id === next.id
  if (prev.type === 'reasoning-delta' && next.type === 'reasoning-delta') return prev.id === next.id
  if (prev.type === 'tool-input-delta' && next.type === 'tool-input-delta') {
    return prev.toolCallId === next.toolCallId
  }
  return false
}

function mergeLiveFrames(previous: ChatRunFrame, incoming: ChatRunFrame): ChatRunFrame {
  const prev = previous.chunk
  const next = incoming.chunk
  if (prev.type === 'text-delta' && next.type === 'text-delta') {
    return {
      ...incoming,
      chunk: {
        ...next,
        delta: prev.delta + next.delta,
        providerMetadata: next.providerMetadata ?? prev.providerMetadata
      }
    }
  }
  if (prev.type === 'reasoning-delta' && next.type === 'reasoning-delta') {
    return {
      ...incoming,
      chunk: {
        ...next,
        delta: prev.delta + next.delta,
        providerMetadata: next.providerMetadata ?? prev.providerMetadata
      }
    }
  }
  if (prev.type === 'tool-input-delta' && next.type === 'tool-input-delta') {
    return {
      ...incoming,
      chunk: {
        ...next,
        inputTextDelta: prev.inputTextDelta + next.inputTextDelta
      }
    }
  }
  return incoming
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

function isTelemetryChunk(
  chunk: InferUIMessageChunk<TanzoUIMessage>
): chunk is ChatNotificationChunk {
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
  if (event === 'retry-attempt') return clone(chunk)
  if (event === 'retry-exhausted' || event === 'operation-error') {
    if (telemetryHasError(chunk)) return clone(chunk)
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
  const pendingByChat = new Map<
    string,
    { event: ChatRunFrame; timer: ReturnType<typeof setTimeout> }
  >()
  const batchMs = options.batchMs ?? DEFAULT_DELTA_BATCH_MS

  const deliver = (event: ChatEvent): void => {
    options.deliver?.(clone(event))
  }

  const flush = (chatId: string): void => {
    const pending = pendingByChat.get(chatId)
    if (!pending) return
    pendingByChat.delete(chatId)
    clearTimeout(pending.timer)
    deliver(pending.event)
  }

  const enqueueLiveFrame = (event: ChatRunFrame): void => {
    if (!options.deliver) return
    if (!isMergeableLiveFrame(event)) {
      flush(event.chatId)
      deliver(event)
      return
    }

    const pending = pendingByChat.get(event.chatId)
    if (pending && canMergeLiveFrames(pending.event, event)) {
      pending.event = mergeLiveFrames(pending.event, event)
      return
    }

    flush(event.chatId)
    const timer = setTimeout(() => flush(event.chatId), batchMs)
    pendingByChat.set(event.chatId, { event, timer })
  }

  return {
    start(chatId, runId, baseMessages, options) {
      const previous = sessions.get(chatId)
      flush(chatId)
      if (previous && previous.runId !== runId && previous.status === 'running') {
        previous.status = 'aborted'
        deliver(stateEvent(chatId, previous.runId, previous.runKind, 'aborted'))
      }
      const runKind = options?.runKind ?? 'chat'
      sessions.set(chatId, {
        chatId,
        runId,
        runKind,
        status: 'running',
        baseMessages: clone(baseMessages),
        notifications: [],
        frames: [],
        retainedNotice: null,
        nextSeq: 1
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
        chunk: clone(chunk)
      }
      session.nextSeq += 1
      pushStoredFrame(session.frames, frame)
      if (isTelemetryChunk(chunk)) {
        session.retainedNotice = reduceRetainedNotice(session.retainedNotice, chunk)
      }
      enqueueLiveFrame(clone(frame))
      return { status: 'accepted', frame: clone(frame) }
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
      flush(chatId)
      session.status = status
      sessions.delete(chatId)
      const event = stateEvent(chatId, runId, session.runKind, status, error)
      deliver(event)
      return event
    },

    snapshot(chatId) {
      const session = sessions.get(chatId)
      if (!session || session.status !== 'running') return null
      const notifications = clone(session.notifications)
      if (session.retainedNotice) notifications.push(clone(session.retainedNotice))
      return {
        chatId,
        runId: session.runId,
        runKind: session.runKind,
        status: 'running',
        baseMessages: clone(session.baseMessages),
        notifications,
        frames: clone(session.frames)
      }
    }
  }
}
