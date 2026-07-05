import { randomUUID } from 'crypto'
import type { ChatRunError, ChatRunStatus } from '@shared/chat'
import type { ChangePreviewData } from '@shared/change-set'
import { ERROR_CODES } from '@shared/errors'
import type { SubagentTraceEntry, TanzoUIMessage } from '@shared/agent-message'
import type { AgentDefinition } from '../agents/types'
import type { ContextEngine } from '../context'
import type { ChangeSetService } from '../git/change-set-service'
import type { ChatKeyedQueue } from './chat-keyed-queue'
import type { CompactionCoordinator } from './compaction-coordinator'
import type { RunEngine } from './run-engine'
import type { ChatRunPersistenceRegistry } from './run-persistence-registry'
import type { ChatRunSessionRegistry } from './run-session-registry'
import { hasPendingApprovalRequest } from '@shared/approval-responses'
import { stripIncompleteInputToolParts } from './sanitize-messages'
import {
  startAgentStream,
  streamStatus,
  terminalRunError,
  type AgentStreamFinalState
} from './stream-runner'
import type { TurnFinalizer } from './turn-finalizer'
import {
  decideTurnOutcome,
  MAX_PLAN_EXIT_PASSES,
  type TurnDecisionContext
} from './turn-loop.machine'
import type { AgentRuntimeDeps, GoalRuntime, Logger } from './types'

const PLAN_EXIT_NUDGE =
  'Plan mode is still active and you ended your turn with a text-only plan. A plan written in ' +
  'plain text is not a submitted plan — the user can only approve it through the exitPlanMode ' +
  'tool. If your plan is ready, call exitPlanMode now with the full plan as markdown. If a ' +
  'genuine decision still blocks the plan, call askQuestion instead. Do not reply with another ' +
  'text-only plan.'

/**
 * True when the transcript's trailing assistant message carries a tool call
 * that has not produced output yet (awaiting approval, just approved, or
 * streaming). Injecting a user message after it would interleave between the
 * call and its result.
 */
function hasUnexecutedToolCall(messages: TanzoUIMessage[]): boolean {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return false
  return last.parts.some((part) => {
    const type = (part as { type?: string }).type
    if (!type || (!type.startsWith('tool-') && type !== 'dynamic-tool')) return false
    const state = (part as { state?: string }).state
    return state !== 'output-available' && state !== 'output-error' && state !== 'output-denied'
  })
}

export interface StartStreamInput {
  chatId: string
  def: AgentDefinition
  messages: TanzoUIMessage[]
  depth: number
  broadcast: boolean
  runId: string
  signal?: AbortSignal
  onTrace?: (entry: SubagentTraceEntry) => void
  isGoalContinuation?: boolean
  deferTerminal?: boolean
  forceExitPlanMode?: boolean
}

export type TurnLoopDeps = AgentRuntimeDeps & {
  logger?: Logger
  contextEngine?: ContextEngine
  goal?: GoalRuntime
  streams?: Pick<ChatRunSessionRegistry, 'start' | 'finish'>
  changeSet?: ChangeSetService
}

export interface TurnLoop {
  run(
    chatId: string,
    incoming: TanzoUIMessage[],
    options?: { isGoalContinuation?: boolean }
  ): Promise<void>
  startChatRun(
    opts: StartStreamInput & {
      onProgress?: () => void
      onStart?: (token: { epoch: number }) => void
    }
  ): Promise<AgentStreamFinalState>
  startGoalContinuation(chatId: string, scheduledGeneration?: number): Promise<void>
  /**
   * Abandon a change-set capture that a turn left pending while waiting for tool
   * approval. Called on cancel/delete so a deferred preview can never leak past
   * the turn it belongs to. No-op when nothing is pending for the chat.
   */
  discardPendingChangeCapture(chatId: string): void
}

export function createTurnLoop(
  deps: TurnLoopDeps,
  collaborators: {
    engine: RunEngine
    runPersistence: ChatRunPersistenceRegistry
    compaction: CompactionCoordinator
    turnFinalizer: TurnFinalizer
    steerQueue: ChatKeyedQueue<string>
  }
): TurnLoop {
  const { engine, runPersistence, compaction, turnFinalizer, steerQueue } = collaborators

  // Change-set capture is scoped to a logical turn, but a turn can span several
  // run() calls when it pauses for tool approval. Carry the in-progress capture
  // id across those pauses (keyed by chat) so the change preview is finalized
  // exactly once — when the turn truly ends — instead of prematurely surfacing
  // (and then duplicating) while an approval card is still pending.
  const pendingChangeCapture = new Map<string, string>()

  const isInflight = (chatId: string): boolean => engine.isRunning(chatId)

  function hasConversation(chatId: string): boolean {
    return Boolean(deps.store.getConversation(chatId))
  }

  function safeFinishStream(
    chatId: string,
    runId: string,
    status: Exclude<ChatRunStatus, 'running'>,
    error?: ChatRunError
  ): void {
    try {
      deps.streams?.finish(chatId, runId, status, error)
    } catch (finishError) {
      deps.logger?.warn('failed to finish run stream', { chatId, runId, error: finishError })
    }
  }

  function safeFinishPersistence(chatId: string, runId: string): void {
    try {
      runPersistence.finish(chatId, runId)
    } catch (error) {
      deps.logger?.warn('failed to finish run persistence', { chatId, runId, error })
    }
  }

  async function runTerminalDispatch(chatId: string, state: AgentStreamFinalState): Promise<void> {
    try {
      await turnFinalizer.dispatch({ chatId, broadcast: true, state })
    } catch (error) {
      deps.logger?.warn('turn dispatch failed', { chatId, error })
    }
  }

  function markRunOutcome(chatId: string, runId: string, state: AgentStreamFinalState): void {
    if (!hasConversation(chatId)) return
    try {
      const errorJson = state.streamFailed
        ? JSON.stringify({
            kind: 'stream-error',
            message: state.streamError ?? 'The model stream failed.'
          })
        : state.aborted
          ? JSON.stringify({ kind: 'aborted' })
          : undefined
      deps.store.markRunOutcome(
        chatId,
        runId,
        state.streamFailed ? 'failed' : 'finished',
        errorJson
      )
    } catch (error) {
      deps.logger?.warn('failed to mark run outcome', { chatId, error })
    }
  }

  function startChatRun(
    opts: StartStreamInput & {
      onProgress?: () => void
      onStart?: (token: { epoch: number }) => void
    }
  ): Promise<AgentStreamFinalState> {
    return engine.run<AgentStreamFinalState>(
      {
        chatId: opts.chatId,
        runId: opts.runId,
        kind: 'chat',
        baseMessages: opts.messages,
        ...(opts.signal ? { parentSignal: opts.signal } : {}),
        ...(opts.deferTerminal ? { deferTerminal: true } : {}),
        ...(opts.onStart ? { onStart: (handle) => opts.onStart?.({ epoch: handle.epoch }) } : {}),
        resolveTerminal: (state) => ({
          status: streamStatus(state),
          ...(terminalRunError(state) ? { error: terminalRunError(state) } : {})
        })
      },
      async (handle) => {
        runPersistence.start(opts.chatId, opts.runId, opts.messages, {
          def: opts.def,
          broadcast: opts.broadcast,
          canPersist: () =>
            !handle.signal.aborted && handle.isCurrent() && hasConversation(opts.chatId),
          canPersistFinal: () => handle.isCurrent() && hasConversation(opts.chatId),
          store: deps.store,
          send: deps.send,
          ...(deps.contextEngine ? { contextEngine: deps.contextEngine } : {}),
          ...(deps.logger ? { logger: deps.logger } : {})
        })

        let finalState!: AgentStreamFinalState
        const { stream } = startAgentStream(deps, {
          ...opts,
          signal: handle.signal,
          steerQueue,
          recordConsumedSteering: (messages, stepNumber) =>
            runPersistence.addConsumedSteering(opts.chatId, opts.runId, messages, stepNumber),
          persistStepMessages: (messages) =>
            runPersistence.persistStepMessages(opts.chatId, opts.runId, messages),
          persistFinalMessages: (messages, state) =>
            runPersistence.persistFinalMessages(opts.chatId, opts.runId, messages, state),
          onTrace: opts.onTrace
            ? (entry) => {
                opts.onTrace?.(entry)
                opts.onProgress?.()
              }
            : undefined,
          onFinally: async (state) => {
            finalState = state
            const wasOwner = handle.release()
            // Always reconcile steering on stream end. Terminal dispatch (queued
            // messages / goal continuation) is driven once by the run() loop for
            // deferred top-level turns. Non-deferred runs (sub-agent tasks) have
            // no such loop, so they dispatch per-run here.
            try {
              turnFinalizer.reconcile({ chatId: opts.chatId, wasOwner, state })
              if (!opts.deferTerminal && wasOwner) {
                await turnFinalizer.dispatch({
                  chatId: opts.chatId,
                  broadcast: opts.broadcast,
                  state
                })
              }
            } catch (error) {
              deps.logger?.warn('turn finalize failed', {
                chatId: opts.chatId,
                runId: opts.runId,
                error
              })
            }
            markRunOutcome(opts.chatId, opts.runId, state)
            safeFinishPersistence(opts.chatId, opts.runId)
          }
        })

        try {
          for await (const _chunk of stream) void _chunk
        } catch (error) {
          if (!finalState) {
            safeFinishPersistence(opts.chatId, opts.runId)
            throw error
          }
          // onFinally already ran, so the terminal state is settled; the throw
          // bypassed the stream's onError (e.g. iterator teardown). Log it so
          // it is not silently lost.
          deps.logger?.warn('chat stream threw after settling', {
            chatId: opts.chatId,
            runId: opts.runId,
            error
          })
        }
        return finalState
      }
    )
  }

  interface ChangeCapture {
    /** The capture id for this logical turn (stable across approval-pause resumes). */
    runId: string
    /** True while a before-checkpoint is live and must be finalized or discarded. */
    started: boolean
    cwd: string | undefined
    carried: boolean
    /** Set once settleChangeCapture ran; repeat calls return the cached verdict. */
    settled?: boolean
    /** Worktree verdict: true/false when verified, null when unavailable. */
    verdict?: boolean | null
  }

  /**
   * Begin (or resume) the change-set capture for a turn. A capture carried over
   * from an approval pause already has a before-checkpoint, so it is not
   * re-captured. Returns the capture state the run() finally uses to finalize,
   * defer, or discard the preview. A failed before-capture leaves `started`
   * false so nothing is finalized later.
   */
  async function beginChangeCapture(chatId: string): Promise<ChangeCapture> {
    const carriedId = pendingChangeCapture.get(chatId)
    const capture: ChangeCapture = {
      runId: carriedId ?? randomUUID(),
      cwd: deps.store.getConversation(chatId)?.cwd,
      carried: carriedId !== undefined,
      started: carriedId !== undefined
    }
    if (deps.changeSet && capture.cwd && !capture.carried) {
      capture.started = true
      await deps.changeSet
        .captureBeforeRun({
          runId: capture.runId,
          chatId,
          assistantMessageId: capture.runId,
          cwd: capture.cwd
        })
        .catch((error) => {
          deps.logger?.warn('change-set captureBeforeRun failed', { chatId, error })
          capture.started = false
        })
    }
    return capture
  }

  /**
   * Finalize the change-set capture at the true end of a turn. When the turn
   * paused for approval, the before-checkpoint is carried to the resuming run()
   * instead of being finalized. Otherwise the preview is captured once (or
   * discarded on failure). Idempotent: the terminal path settles before goal
   * dispatch to obtain the worktree verdict (invariant I5); the run() finally
   * re-invokes it as a safety net and gets the cached verdict.
   *
   * Returns the worktree verdict: true (changed), false (verified unchanged),
   * or null (no capture / deferred / failed).
   */
  async function settleChangeCapture(
    chatId: string,
    capture: ChangeCapture,
    turnAwaitingApproval: boolean
  ): Promise<boolean | null> {
    if (capture.settled) return capture.verdict ?? null
    if (!capture.started || !deps.changeSet || !capture.cwd) {
      capture.settled = true
      capture.verdict = null
      return null
    }
    if (turnAwaitingApproval) {
      // Deferred: keep the before-checkpoint alive for the resuming run(). A
      // cancel/delete clears it explicitly via discardPendingChangeCapture, so
      // a paused capture can never leak past the turn it belongs to.
      pendingChangeCapture.set(chatId, capture.runId)
      capture.settled = true
      capture.verdict = null
      return null
    }
    pendingChangeCapture.delete(chatId)
    capture.settled = true
    try {
      const preview = await finalizeChangeSet(chatId, capture.runId)
      capture.verdict = preview ? preview.fileCount > 0 : false
    } catch (error) {
      deps.logger?.warn('change-set captureAfterRun failed', { chatId, error })
      deps.changeSet?.discard(capture.runId)
      capture.verdict = null
    }
    return capture.verdict
  }

  async function run(
    chatId: string,
    incoming: TanzoUIMessage[],
    options: { isGoalContinuation?: boolean } = {}
  ): Promise<void> {
    const preparation = new AbortController()
    engine.setPreparing(chatId, preparation)
    let releaseActiveRun!: () => void
    engine.track(
      new Promise<void>((resolve) => {
        releaseActiveRun = resolve
      })
    )

    const endPreparation = (): void => {
      engine.clearPreparing(chatId, preparation)
    }
    const isPreparationCancelled = (): boolean => preparation.signal.aborted
    const stopIfPreparationCancelled = (): boolean => {
      if (!isPreparationCancelled()) return false
      endPreparation()
      return true
    }

    let messages = stripIncompleteInputToolParts(incoming)
    const changeCapture = await beginChangeCapture(chatId)
    if (changeCapture.started && !changeCapture.carried && stopIfPreparationCancelled()) {
      // A brand-new before-checkpoint was just taken but preparation was already
      // cancelled: discard it here since the run() finally will not execute.
      deps.changeSet?.discard(changeCapture.runId)
      releaseActiveRun()
      return
    }
    let pendingTerminal: {
      runId: string
      status: Exclude<ChatRunStatus, 'running'>
      error?: ChatRunError
    } | null = null
    let planExitPasses = 0
    let forceExitPlanMode = false
    let injectedThisTurn = false
    // Set only when the turn ends naturally with an unresolved approval request,
    // i.e. it will resume in a later run(). Any abort/failure/early-return leaves
    // this false so the capture is finalized (or discarded) like before.
    let turnAwaitingApproval = false
    try {
      for (;;) {
        if (stopIfPreparationCancelled()) return
        const runId = randomUUID()
        const def = await deps.store.resolveAgentDefinition(chatId)
        if (stopIfPreparationCancelled()) return

        // Persist the volatile context injection (datetime, git snapshot, goal
        // nudge, hook context) as a synthetic user message at turn start — the
        // model transcript stays append-only within the run and the persisted
        // history matches what the model actually saw (invariant I1). Only once
        // per logical turn: plan-exit retry passes reuse the injected message.
        // Skipped while a tool call awaits approval or execution (the approval
        // resume path): a user message must not be interleaved between a tool
        // call and its result. Goal continuations (settled assistant tail) do
        // inject — that is how the continuation prompt reaches the model.
        if (
          !injectedThisTurn &&
          deps.contextEngine &&
          messages.length > 0 &&
          !hasUnexecutedToolCall(messages)
        ) {
          injectedThisTurn = true
          try {
            const cwd = deps.store.getConversation(chatId)?.cwd ?? process.cwd()
            const isFirstTurn = !messages.some((message) => message.role === 'assistant')
            const injection = await deps.contextEngine.renderInjection(def, chatId, cwd, {
              isFirstTurn
            })
            if (injection) messages = [...messages, injection]
          } catch (error) {
            deps.logger?.warn('context injection failed', { chatId, error })
          }
        }

        if (messages.length > 0 && deps.store.getConversation(chatId)) {
          deps.store.save(chatId, messages)
        }
        if (stopIfPreparationCancelled()) return
        const prepared = await compaction.prepareMessages(chatId, def, messages, runId, {
          signal: preparation.signal
        })
        if (stopIfPreparationCancelled()) return
        endPreparation()
        let state: AgentStreamFinalState
        try {
          state = await startChatRun({
            chatId,
            def,
            messages: prepared,
            depth: deps.store.depthOf(chatId),
            broadcast: true,
            runId,
            isGoalContinuation: options.isGoalContinuation ?? false,
            deferTerminal: true,
            ...(forceExitPlanMode ? { forceExitPlanMode: true } : {})
          })
        } catch (error) {
          // An abort can surface as an AbortError throw from preparation or
          // stream teardown; report it as a cancellation instead of a failure.
          // (run-engine already finished the stream session with the correct
          // status on throw, so this only keeps pendingTerminal consistent.)
          const aborted = error instanceof Error && error.name === 'AbortError'
          pendingTerminal = aborted
            ? { runId, status: 'aborted' }
            : {
                runId,
                status: 'failed',
                error: {
                  code: ERROR_CODES.CHAT_RUN_FAILED,
                  message: error instanceof Error ? error.message : String(error)
                }
              }
          throw error
        }
        const status = streamStatus(state)

        // Reconcile an in-stream compaction against the persisted transcript:
        // archive the head under the summary the fork already produced (no
        // second summarization).
        if (state.inlineCompaction && !state.aborted) {
          try {
            await compaction.reconcileInline(chatId, def, state.inlineCompaction, {
              signal: preparation.signal
            })
          } catch (error) {
            deps.logger?.warn('inline compaction reconcile failed', { chatId, error })
          }
        }

        const decision = decideTurnOutcome(state, {
          planExitPasses,
          isPlanMode: deps.policy.getMode(deps.store.rootOf(chatId)) === 'plan',
          isInflight: isInflight(chatId),
          hasConversation: Boolean(deps.store.getConversation(chatId))
        } satisfies TurnDecisionContext)

        if (decision.kind === 'plan-exit-retry') {
          const nextMessages = await deps.store.load(chatId)
          if (nextMessages.length > 0) {
            safeFinishStream(chatId, runId, status)
            planExitPasses += 1
            forceExitPlanMode = planExitPasses >= MAX_PLAN_EXIT_PASSES
            messages = [
              ...nextMessages,
              {
                id: randomUUID(),
                role: 'user',
                parts: [{ type: 'text', text: PLAN_EXIT_NUDGE }]
              }
            ]
            engine.setPreparing(chatId, preparation)
            continue
          }
        }

        // A turn that stops to wait for tool approval is not actually over — it
        // resumes in a fresh run() once the user responds — so flag it to defer
        // the change preview instead of surfacing it under the approval card.
        turnAwaitingApproval =
          !state.aborted && !state.streamFailed && (await turnPausedForApproval(chatId))

        // Settle the change capture before terminal dispatch so the goal
        // evaluation reads the real worktree verdict (invariant I5). The
        // finally-side settle becomes a no-op afterwards.
        state.worktreeChanged = await settleChangeCapture(
          chatId,
          changeCapture,
          turnAwaitingApproval
        )

        // Terminal turn: dispatch queued work / goal continuation exactly once.
        // The plan-exit retry path `continue`s above and never reaches here.
        await runTerminalDispatch(chatId, state)

        pendingTerminal = {
          runId,
          status,
          ...(terminalRunError(state) ? { error: terminalRunError(state) } : {})
        }
        break
      }
    } finally {
      endPreparation()
      await settleChangeCapture(chatId, changeCapture, turnAwaitingApproval)
      if (pendingTerminal) {
        safeFinishStream(
          chatId,
          pendingTerminal.runId,
          pendingTerminal.status,
          pendingTerminal.error
        )
      }
      releaseActiveRun()
    }
  }

  async function turnPausedForApproval(chatId: string): Promise<boolean> {
    if (!deps.store.getConversation(chatId)) return false
    try {
      return hasPendingApprovalRequest(await deps.store.load(chatId))
    } catch (error) {
      deps.logger?.warn('failed to inspect pending approvals', { chatId, error })
      return false
    }
  }

  /** Capture the after-checkpoint and attach the preview. Returns the preview
   *  (null = worktree unchanged or nothing to attach). */
  async function finalizeChangeSet(
    chatId: string,
    runId: string
  ): Promise<ChangePreviewData | null> {
    if (!deps.changeSet) return null
    const cwd = deps.store.getConversation(chatId)?.cwd
    if (!cwd) {
      deps.changeSet.discard(runId)
      return null
    }
    const messages = await deps.store.load(chatId)
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    const assistantMessageId = lastAssistant?.id ?? runId
    const preview = await deps.changeSet.captureAfterRun({
      runId,
      chatId,
      assistantMessageId,
      cwd
    })
    if (!preview || !lastAssistant) return preview
    const withPreview: TanzoUIMessage = {
      ...lastAssistant,
      parts: [
        ...lastAssistant.parts.filter(
          (part) => (part as { type?: string }).type !== 'data-changePreview'
        ),
        { type: 'data-changePreview', id: `changePreview:${runId}`, data: preview } as never
      ]
    }
    const nextMessages = messages.map((message) =>
      message.id === lastAssistant.id ? withPreview : message
    )
    deps.store.save(chatId, nextMessages)
    deps.send(chatId, {
      type: 'data-changePreview',
      id: `changePreview:${runId}`,
      data: preview,
      transient: true
    } as never)
    return preview
  }

  async function startGoalContinuation(
    chatId: string,
    scheduledGeneration?: number
  ): Promise<void> {
    // Guard on the CANCEL clock, not the epoch. A goal continuation is scheduled
    // through the mailbox and may execute after other legitimate run activity has
    // begun on this chat. We only want to abandon it if the user explicitly
    // cancelled between scheduling and execution — which is exactly what
    // cancelGeneration tracks. Using the epoch clock here would also drop the
    // continuation whenever any normal run started in the gap. See the RunEngine
    // "two generation clocks" contract note.
    if (
      scheduledGeneration !== undefined &&
      engine.currentCancelGeneration(chatId) !== scheduledGeneration
    ) {
      return
    }
    if (isInflight(chatId)) return
    const goal = deps.goal?.get(chatId)
    if (!goal) return
    if (!deps.store.getConversation(chatId)) return
    let messages = await deps.store.load(chatId)
    if (messages.length === 0) {
      messages = [
        {
          id: randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: goal.objective }]
        }
      ]
    }
    await run(chatId, messages, { isGoalContinuation: true })
  }

  function discardPendingChangeCapture(chatId: string): void {
    const runId = pendingChangeCapture.get(chatId)
    if (runId === undefined) return
    pendingChangeCapture.delete(chatId)
    deps.changeSet?.discard(runId)
  }

  return { run, startChatRun, startGoalContinuation, discardPendingChangeCapture }
}
