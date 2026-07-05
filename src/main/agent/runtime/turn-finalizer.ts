import { randomUUID } from 'crypto'
import type { QueuedMessage } from '@shared/agent-message'
import { effectiveTokens } from '../goal/accounting'
import type { ChatKeyedQueue } from './chat-keyed-queue'
import type { AgentRuntimeDeps, GoalRuntime, Logger } from './types'
import type { AgentStreamFinalState } from './stream-runner'

export interface TurnFinalizerDeps extends AgentRuntimeDeps {
  logger?: Logger
  goal?: GoalRuntime
}

export interface TurnFinalizer {
  /**
   * Per-stream cleanup, run on every stream end (including intermediate
   * compaction passes). Owner-only: clears steering on abort, otherwise carries
   * any steering that was not consumed this run forward as queued messages.
   */
  reconcile(input: { chatId: string; wasOwner: boolean; state: AgentStreamFinalState }): void
  /**
   * Terminal dispatch, run exactly once when the turn loop decides the turn is
   * over: hands off the next queued message, or evaluates goal continuation.
   * Self-guards on abort/failure/inflight, so callers may invoke it for any
   * terminal decision.
   */
  dispatch(input: {
    chatId: string
    broadcast: boolean
    state: AgentStreamFinalState
  }): Promise<void>
}

export function createTurnFinalizer(
  deps: TurnFinalizerDeps,
  queues: {
    steerQueue: ChatKeyedQueue<string>
    messageQueue: ChatKeyedQueue<QueuedMessage>
  },
  callbacks: {
    submitUserMessage(chatId: string, message: string): Promise<void>
    startGoalContinuation(chatId: string): Promise<void>
    isInflight(chatId: string): boolean
    publishQueue(chatId: string): void
  }
): TurnFinalizer {
  return {
    reconcile({ chatId, wasOwner, state }) {
      if (!wasOwner) return
      if (state.aborted) {
        queues.steerQueue.clear(chatId)
        return
      }
      const residualSteering = queues.steerQueue.drain(chatId)
      if (residualSteering.length === 0) return
      for (const text of residualSteering) {
        queues.messageQueue.push(chatId, { id: randomUUID(), text })
      }
      callbacks.publishQueue(chatId)
    },

    async dispatch({ chatId, broadcast, state }) {
      if (!broadcast || callbacks.isInflight(chatId) || !deps.store.getConversation(chatId)) {
        return
      }

      const hasQueuedMessage = queues.messageQueue.list(chatId).length > 0
      let goalWantsContinuation = false

      // Accounting runs for every turn — including failed and aborted ones
      // (invariant I3: burned tokens always land in the ledger). Only healthy
      // turns are outcome-eligible; the machine returns continue=false for the
      // rest.
      if (deps.goal) {
        const conversation = deps.store.getConversation(chatId)
        const isMainAgent = !conversation?.parentConversationId
        if (isMainAgent && deps.goal.get(chatId)) {
          const turnTokens = effectiveTokens(state.latestUsage)
          const turnSeconds = Math.round((Date.now() - state.turnStartedAt) / 1000)
          const isPlanMode = deps.policy.getMode(deps.store.rootOf(chatId)) === 'plan'
          const outcomeEligible = !state.aborted && !state.streamFailed
          const decision = deps.goal.evaluate(chatId, {
            isGoalContinuation: state.isGoalContinuation,
            worktreeChanged: state.worktreeChanged ?? null,
            producedWorkToolCall: state.producedWorkToolCall,
            turnTokens,
            turnSeconds,
            isPlanMode,
            suppressContinuation: hasQueuedMessage,
            outcomeEligible
          })
          goalWantsContinuation = decision.continue && outcomeEligible
          if (!decision.continue && decision.reason !== 'not-active') {
            deps.logger?.info('goal continuation stopped', {
              chatId,
              reason: decision.reason
            })
          }
        }
      }

      if (state.aborted) return

      const next = queues.messageQueue.shift(chatId)
      if (next !== undefined) {
        callbacks.publishQueue(chatId)
        void callbacks
          .submitUserMessage(chatId, next.text)
          .catch((error) => deps.logger?.warn('queued message dispatch failed', { chatId, error }))
        return
      }

      if (goalWantsContinuation) {
        void callbacks
          .startGoalContinuation(chatId)
          .catch((error) => deps.logger?.warn('goal continuation failed', { chatId, error }))
      }
    }
  }
}
