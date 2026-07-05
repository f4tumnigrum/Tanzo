import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { TanzoError } from '@shared/errors'
import type {
  ChatApi,
  ChatRunError,
  ChatRunFrame,
  ChatRunKind,
  ChatRunSnapshot,
  ChatRunStateEvent,
  ChatRunStatus
} from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'

type RunEventApi = Pick<ChatApi, 'onEvent' | 'runSnapshot'>

function isTerminalState(event: ChatRunStateEvent): boolean {
  return event.status === 'finished' || event.status === 'failed' || event.status === 'aborted'
}

function shouldReplaySnapshotFrame(frame: ChatRunFrame): boolean {
  return frame.chunk.type !== 'data-telemetry'
}

export function createFrameGate(): {
  lock(runId: string): void
  activeRunId(): string | null
  accept(frame: ChatRunFrame): boolean
} {
  let activeRunId: string | null = null
  let replayedSeq = 0
  return {
    lock(runId) {
      activeRunId = runId
      replayedSeq = 0
    },
    activeRunId() {
      return activeRunId
    },
    accept(frame) {
      if (!activeRunId || frame.runId !== activeRunId || frame.seq <= replayedSeq) return false
      replayedSeq = frame.seq
      return true
    }
  }
}

export interface MessageSink {
  enqueue(chunk: UIMessageChunk): void
  close(): void
}

export function createMessageSink(handlers: {
  onMessage: (message: TanzoUIMessage) => void
  onSettled?: () => void | Promise<void>
  onError?: (error: unknown) => void
  seedMessage?: TanzoUIMessage
}): MessageSink {
  let controller: ReadableStreamDefaultController<UIMessageChunk> | null = null
  let closed = false
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      controller = c
    }
  })
  void (async () => {
    try {
      for await (const message of readUIMessageStream<TanzoUIMessage>({
        stream,
        // The AI SDK reports native `error` chunks only through this callback
        // (processUIMessageStream calls onError?.() — without it they are
        // silently dropped). The terminal run-state event is the primary error
        // channel, so just forward these to the same handler.
        onError: (error) => handlers.onError?.(error),
        ...(handlers.seedMessage ? { message: handlers.seedMessage } : {})
      })) {
        handlers.onMessage(message)
      }
    } catch (error) {
      handlers.onError?.(error)
    } finally {
      await handlers.onSettled?.()
    }
  })()
  return {
    enqueue(chunk) {
      if (closed) return
      try {
        controller?.enqueue(chunk)
      } catch {
        // The stream can close between the guard and enqueue; dropping late chunks is safe.
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        controller?.close()
      } catch {
        // The controller may already be closed by the reader; close is best-effort.
      }
    }
  }
}

export interface RunConnection {
  close(): void
}

export async function connectRun(
  api: RunEventApi,
  chatId: string,
  handlers: {
    onRunStart?: (snapshot: ChatRunSnapshot) => void
    onChunk: (chunk: UIMessageChunk) => void
    onSettled?: (outcome?: { status: ChatRunStatus | null }) => void | Promise<void>
    onError?: (error: unknown) => void
    persistent?: boolean
    attachExisting?: boolean
  }
): Promise<RunConnection | null> {
  let gate = createFrameGate()
  const liveFrames: ChatRunFrame[] = []
  const terminalRunIds = new Set<string>()
  const terminalRunErrors = new Map<string, ChatRunError>()
  const terminalRunStatuses = new Map<string, ChatRunStatus>()
  const MAX_LIVE_FRAMES = 2000
  const MAX_TERMINAL_RUN_IDS = 100
  let live = false
  let closed = false
  let attaching = false

  let unsubscribe: () => void = () => {}
  const shouldAttachExisting = handlers.attachExisting ?? true
  const close = (): void => {
    if (closed) return
    closed = true
    unsubscribe()
  }

  const settle = (): void => {
    if (!live && !handlers.persistent) return
    const settledRunId = gate.activeRunId()
    let status: ChatRunStatus | null = null
    if (settledRunId) {
      reportRunError(settledRunId)
      terminalRunIds.delete(settledRunId)
      status = terminalRunStatuses.get(settledRunId) ?? null
      terminalRunStatuses.delete(settledRunId)
    }
    live = false
    liveFrames.length = 0
    void handlers.onSettled?.({ status })
    if (!handlers.persistent) close()
  }

  const reportRunError = (runId: string): void => {
    const error = terminalRunErrors.get(runId)
    if (!error) return
    terminalRunErrors.delete(runId)
    handlers.onError?.(new TanzoError(error.code, error.message))
  }

  const settleIfTerminalArrived = (): void => {
    const runId = gate.activeRunId()
    if (runId && terminalRunIds.has(runId)) settle()
  }

  const push = (frame: ChatRunFrame): void => {
    if (closed || !live || !gate.accept(frame)) return
    handlers.onChunk(frame.chunk)
  }

  const attach = async (expected?: {
    runId: string
    runKind: ChatRunKind
  }): Promise<ChatRunSnapshot | null> => {
    if (attaching || live || closed) return null
    attaching = true
    try {
      const snapshot = await api.runSnapshot(chatId)
      if (closed) return snapshot
      if (!snapshot) {
        if (expected && (handlers.persistent || handlers.attachExisting === false)) {
          gate = createFrameGate()
          gate.lock(expected.runId)
          live = true
          // The main process is running this turn but its snapshot isn't queryable
          // yet. Notify onRunStart anyway (with empty base messages, which merge to
          // keep the current display) so the consumer can build its message sink;
          // otherwise live frames replayed below would be silently dropped.
          handlers.onRunStart?.({
            chatId,
            runId: expected.runId,
            runKind: expected.runKind,
            status: 'running',
            baseMessages: [],
            notifications: [],
            frames: []
          })
          for (const frame of liveFrames) push(frame)
          settleIfTerminalArrived()
        }
        return snapshot
      }
      gate = createFrameGate()
      gate.lock(snapshot.runId)
      live = true
      handlers.onRunStart?.(snapshot)
      for (const chunk of snapshot.notifications) {
        handlers.onChunk(chunk)
      }
      for (const frame of snapshot.frames) {
        if (shouldReplaySnapshotFrame(frame)) push(frame)
        else gate.accept(frame)
      }
      for (const frame of liveFrames) push(frame)
      settleIfTerminalArrived()
      return snapshot
    } finally {
      attaching = false
    }
  }

  unsubscribe = api.onEvent(chatId, (event) => {
    if (event.kind === 'run-state') {
      if (event.status === 'running' && !live)
        void attach({ runId: event.runId, runKind: event.runKind })
      if (event.status === 'failed' && event.error) {
        terminalRunErrors.set(event.runId, event.error)
      }
      if (isTerminalState(event)) {
        terminalRunStatuses.set(event.runId, event.status)
        if (event.runId === gate.activeRunId()) settle()
        else {
          if (terminalRunIds.size >= MAX_TERMINAL_RUN_IDS) {
            const oldest = terminalRunIds.values().next().value
            if (oldest !== undefined) {
              terminalRunIds.delete(oldest)
              terminalRunErrors.delete(oldest)
              terminalRunStatuses.delete(oldest)
            }
          }
          terminalRunIds.add(event.runId)
        }
      }
      return
    }
    // The main process delivers frames tick-batched (`run-frame-batch`); a
    // batch is semantically identical to its frames delivered one by one, and
    // each contained frame passes the same seq gate. Single `run-frame`
    // events are still accepted for compatibility.
    if (event.kind !== 'run-frame' && event.kind !== 'run-frame-batch') return
    const frames = event.kind === 'run-frame' ? [event] : event.frames
    if (live) {
      for (const frame of frames) push(frame)
      return
    }
    for (const frame of frames) {
      liveFrames.push(frame)
      if (liveFrames.length > MAX_LIVE_FRAMES) liveFrames.shift()
    }
    if (handlers.persistent && shouldAttachExisting) void attach()
  })

  let snapshot: ChatRunSnapshot | null = null
  try {
    if (shouldAttachExisting) snapshot = await attach()
  } catch (error) {
    close()
    throw error
  }
  if (!snapshot && !handlers.persistent) {
    close()
    return null
  }

  return { close }
}
