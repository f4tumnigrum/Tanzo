import type { ChatRunError, ChatRunKind, ChatRunStatus } from '@shared/chat'
import { ERROR_CODES } from '@shared/errors'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { ChatRunSessionRegistry } from './run-session-registry'
import type { Logger } from './types'

export interface RunSlot {
  controller: AbortController
  epoch: number
  unlink: () => void
}

export interface RunHandle {
  readonly chatId: string
  readonly runId: string
  readonly kind: ChatRunKind
  readonly epoch: number
  readonly signal: AbortSignal
  isCurrent(): boolean
  release(): boolean
}

export interface RunLifecycleInput<T = unknown> {
  chatId: string
  runId: string
  kind: ChatRunKind
  baseMessages: TanzoUIMessage[]
  parentSignal?: AbortSignal
  deferTerminal?: boolean
  onStart?: (handle: RunHandle) => void
  resolveTerminal?: (result: T) => {
    status: Exclude<ChatRunStatus, 'running'>
    error?: ChatRunError
  }
}

/**
 * The RunEngine tracks TWO independent per-chat "generation" clocks. They look
 * similar but answer different questions, and a call site must pick the right
 * one — mixing them up is the historical source of cancel/supersede races.
 *
 * 1. EPOCH (`currentEpoch` / `hasAdvancedSince`) — the *run-activity* clock.
 *    Bumped on EVERY `beginRun` and EVERY `abort`. It answers: "has any newer
 *    run activity taken over this chat since the moment I captured `epoch`?"
 *    Use it to detect that the run you are driving has been SUPERSEDED — either
 *    a new run started or the current one was aborted. This is what the subagent
 *    driver checks around each streaming pass.
 *
 * 2. CANCEL GENERATION (`currentCancelGeneration` / `bumpCancelGeneration`) —
 *    the *explicit-cancel* clock. Bumped ONLY by `AgentService.cancel`. It
 *    answers: "did the user explicitly cancel this chat since I was scheduled?"
 *    Use it for deferred work (e.g. a goal continuation queued on the mailbox)
 *    that must NOT run if a cancel arrived in the gap between scheduling and
 *    execution. It deliberately does NOT advance when an ordinary new run
 *    begins, so a legitimate interleaved run can't be mistaken for a cancel.
 *
 * Do NOT collapse these into one counter: `startGoalContinuation` relies on the
 * cancel clock staying still across unrelated `beginRun`s, while supersede
 * detection relies on the epoch clock moving on every run boundary.
 */
export interface RunEngine {
  /** Current EPOCH (run-activity clock) for the chat. See interface docs. */
  currentEpoch(chatId: string): number
  beginRun(chatId: string, parentSignal?: AbortSignal): RunSlot
  run<T>(input: RunLifecycleInput<T>, body: (handle: RunHandle) => Promise<T>): Promise<T>
  /**
   * True if the EPOCH advanced past `epoch` — i.e. a newer run began or an
   * abort fired. Used to detect a superseded run. NOT affected by cancel
   * generation; a plain user cancel that also aborts moves the epoch anyway.
   */
  hasAdvancedSince(chatId: string, epoch: number): boolean
  isOwner(chatId: string, controller: AbortController): boolean
  releaseIfOwner(chatId: string, controller: AbortController): boolean
  currentController(chatId: string): AbortController | undefined
  setPreparing(chatId: string, controller: AbortController): void
  clearPreparing(chatId: string, controller: AbortController): void
  /**
   * Abort the preparing + inflight controllers for the chat. Intentionally also
   * advances the EPOCH clock (so any run observing via `hasAdvancedSince` sees a
   * supersede), but leaves the CANCEL GENERATION untouched — callers that mean
   * "the user cancelled" must call `AgentService.cancel`, which bumps the cancel
   * generation before aborting.
   */
  abort(chatId: string): void
  isRunning(chatId: string): boolean
  listRunning(): string[]
  track<T>(promise: Promise<T>): Promise<T>
  settle(timeoutMs: number): Promise<boolean>
  /** Current CANCEL GENERATION (explicit-cancel clock). See interface docs. */
  currentCancelGeneration(chatId: string): number
  /** Advance the CANCEL GENERATION. Call only from an explicit user cancel. */
  bumpCancelGeneration(chatId: string): number
}

function linkAbortSignal(
  parentSignal: AbortSignal | undefined,
  controller: AbortController
): () => void {
  if (!parentSignal) return () => {}
  if (parentSignal.aborted) {
    controller.abort()
    return () => {}
  }
  const abort = (): void => controller.abort()
  parentSignal.addEventListener('abort', abort, { once: true })
  return () => parentSignal.removeEventListener('abort', abort)
}

export interface RunEngineDeps {
  streams?: Pick<ChatRunSessionRegistry, 'start' | 'finish'>
  logger?: Logger
}

export function createRunEngine(deps: RunEngineDeps = {}): RunEngine {
  const inflight = new Map<string, AbortController>()
  const preparing = new Map<string, AbortController>()
  const epochs = new Map<string, number>()
  const cancelGenerations = new Map<string, number>()
  const activeRuns = new Set<Promise<unknown>>()

  const currentEpoch = (chatId: string): number => epochs.get(chatId) ?? 0
  const nextEpoch = (chatId: string): number => {
    const epoch = currentEpoch(chatId) + 1
    epochs.set(chatId, epoch)
    return epoch
  }

  return {
    currentEpoch,

    beginRun(chatId, parentSignal) {
      const epoch = nextEpoch(chatId)
      inflight.get(chatId)?.abort()
      const controller = new AbortController()
      const unlink = linkAbortSignal(parentSignal, controller)
      inflight.set(chatId, controller)
      return { controller, epoch, unlink }
    },

    async run(input, body) {
      const { controller, epoch, unlink } = this.beginRun(input.chatId, input.parentSignal)
      const handle: RunHandle = {
        chatId: input.chatId,
        runId: input.runId,
        kind: input.kind,
        epoch,
        signal: controller.signal,
        isCurrent: () => inflight.get(input.chatId) === controller,
        release: () => this.releaseIfOwner(input.chatId, controller)
      }

      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve
      })
      this.track(done)

      input.onStart?.(handle)
      deps.streams?.start(input.chatId, input.runId, input.baseMessages, { runKind: input.kind })

      let status: Exclude<ChatRunStatus, 'running'> = 'finished'
      let runError: ChatRunError | undefined
      let threw = false
      try {
        const result = await body(handle)
        if (input.resolveTerminal) {
          const terminal = input.resolveTerminal(result)
          status = terminal.status
          runError = terminal.error
        }
        return result
      } catch (error) {
        threw = true
        if (controller.signal.aborted) {
          status = 'aborted'
        } else {
          status = 'failed'
          runError = {
            code: ERROR_CODES.CHAT_RUN_FAILED,
            message: error instanceof Error ? error.message : String(error)
          }
        }
        throw error
      } finally {
        unlink()
        this.releaseIfOwner(input.chatId, controller)
        if (!input.deferTerminal || threw) {
          try {
            deps.streams?.finish(input.chatId, input.runId, status, runError)
          } catch (finishError) {
            deps.logger?.warn('failed to finish run stream', {
              chatId: input.chatId,
              runId: input.runId,
              error: finishError
            })
          }
        }
        resolveDone()
      }
    },

    hasAdvancedSince(chatId, epoch) {
      return currentEpoch(chatId) !== epoch
    },

    isOwner(chatId, controller) {
      return inflight.get(chatId) === controller
    },

    releaseIfOwner(chatId, controller) {
      if (inflight.get(chatId) !== controller) return false
      inflight.delete(chatId)
      return true
    },

    currentController(chatId) {
      return inflight.get(chatId)
    },

    setPreparing(chatId, controller) {
      preparing.set(chatId, controller)
    },

    clearPreparing(chatId, controller) {
      if (preparing.get(chatId) === controller) preparing.delete(chatId)
    },

    abort(chatId) {
      // Advancing the epoch here is intentional: an abort supersedes the current
      // run for hasAdvancedSince() consumers even if no replacement run begins.
      // This does NOT touch the cancel generation — see the RunEngine doc comment.
      nextEpoch(chatId)
      preparing.get(chatId)?.abort()
      inflight.get(chatId)?.abort()
    },

    isRunning(chatId) {
      return inflight.has(chatId) || preparing.has(chatId)
    },

    listRunning() {
      return [...new Set([...preparing.keys(), ...inflight.keys()])]
    },

    track(promise) {
      activeRuns.add(promise)
      void promise.finally(() => activeRuns.delete(promise))
      return promise
    },

    async settle(timeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (activeRuns.size > 0) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return false
        await Promise.race([
          Promise.all([...activeRuns]),
          new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 50)))
        ])
      }
      return true
    },

    currentCancelGeneration(chatId) {
      return cancelGenerations.get(chatId) ?? 0
    },

    bumpCancelGeneration(chatId) {
      const next = (cancelGenerations.get(chatId) ?? 0) + 1
      cancelGenerations.set(chatId, next)
      return next
    }
  }
}
