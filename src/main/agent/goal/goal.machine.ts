import type { GoalDecisionReason, GoalInjection, GoalOutcome, ThreadGoal } from '@shared/goal'
import { next, stay, type Transition } from '../runtime/machine/types'

export const IDLE_STREAK_LIMIT = 2

export const BLOCK_ATTEMPTS_REQUIRED = 3

export interface GoalTurnInput {
  isGoalContinuation: boolean

  worktreeChanged: boolean | null

  producedWorkToolCall: boolean
  turnTokens: number
  turnSeconds: number
  isPlanMode: boolean
  suppressContinuation: boolean

  outcomeEligible: boolean
}

export type GoalEvent =
  | { kind: 'objective-updated'; objective: string }
  | { kind: 'user-paused' }
  | { kind: 'user-resumed' }
  | { kind: 'turn-evaluated'; turn: GoalTurnInput }
  | { kind: 'outcome-marked'; outcome: GoalOutcome; runId?: string }
  | { kind: 'usage-limited' }

export type GoalEffect =
  | { kind: 'persist' }
  | { kind: 'broadcast' }
  | { kind: 'decision'; continue: boolean; reason: GoalDecisionReason }
  | { kind: 'reject'; code: 'blocked-too-early'; attempts: number; required: number }

const PERSIST_BROADCAST: readonly GoalEffect[] = [{ kind: 'persist' }, { kind: 'broadcast' }]

function withInjection(goal: ThreadGoal, pendingInjection: GoalInjection | null): ThreadGoal {
  return { ...goal, pendingInjection }
}

function isBudgetExhausted(goal: ThreadGoal): boolean {
  if (goal.tokenBudget != null && goal.tokensUsed >= goal.tokenBudget) return true
  if (goal.timeBudgetSeconds != null && goal.timeUsedSeconds >= goal.timeBudgetSeconds) return true
  return false
}

function resetForResume(goal: ThreadGoal): ThreadGoal {
  return {
    ...goal,
    userState: 'active',
    outcome: null,
    limit: null,
    idleStreak: 0,
    blockerStreak: 0,
    blockerLastRunId: null,
    pendingInjection: 'continuation'
  }
}

function hasWorkEvidence(turn: GoalTurnInput): boolean {
  if (turn.worktreeChanged === true) return true
  if (turn.worktreeChanged === null && turn.producedWorkToolCall) return true
  return false
}

function evaluateTurn(goal: ThreadGoal, turn: GoalTurnInput): Transition<ThreadGoal, GoalEffect> {
  const workEvidence = hasWorkEvidence(turn)
  const idleStreak = !turn.isGoalContinuation ? 0 : workEvidence ? 0 : goal.idleStreak + 1

  const accounted: ThreadGoal = {
    ...goal,
    tokensUsed: goal.tokensUsed + Math.max(0, turn.turnTokens),
    timeUsedSeconds: goal.timeUsedSeconds + Math.max(0, turn.turnSeconds),
    idleStreak,

    blockerStreak: workEvidence ? 0 : goal.blockerStreak
  }

  const decided = (
    state: ThreadGoal,
    cont: boolean,
    reason: GoalDecisionReason
  ): Transition<ThreadGoal, GoalEffect> =>
    next(state, [...PERSIST_BROADCAST, { kind: 'decision', continue: cont, reason }])

  if (accounted.userState !== 'active' || accounted.outcome || accounted.limit) {
    return decided(accounted, false, 'not-active')
  }
  if (!turn.outcomeEligible) {
    return decided(accounted, false, 'not-active')
  }

  if (isBudgetExhausted(accounted)) {
    const wrapUp = !turn.isPlanMode && !turn.suppressContinuation
    const limited: ThreadGoal = { ...accounted, limit: 'budget', pendingInjection: 'budget_limit' }
    return decided(limited, wrapUp, wrapUp ? 'wrap-up' : 'budget-exhausted')
  }

  if (turn.isPlanMode) return decided(accounted, false, 'plan-mode')
  if (turn.suppressContinuation) return decided(accounted, false, 'queued-message')
  if (idleStreak >= IDLE_STREAK_LIMIT) return decided(accounted, false, 'idle-limit')

  return decided(withInjection(accounted, 'continuation'), true, 'continue')
}

function markOutcome(
  goal: ThreadGoal,
  outcome: GoalOutcome,
  runId: string | undefined
): Transition<ThreadGoal, GoalEffect> {
  if (outcome === 'blocked') {
    const alreadyCounted = runId !== undefined && goal.blockerLastRunId === runId
    const attempts = alreadyCounted ? goal.blockerStreak : goal.blockerStreak + 1
    if (attempts < BLOCK_ATTEMPTS_REQUIRED) {
      const recorded: ThreadGoal = {
        ...goal,
        blockerStreak: attempts,
        blockerLastRunId: runId ?? null
      }
      return next(recorded, [
        ...PERSIST_BROADCAST,
        {
          kind: 'reject',
          code: 'blocked-too-early',
          attempts,
          required: BLOCK_ATTEMPTS_REQUIRED
        }
      ])
    }
    return next(
      {
        ...goal,
        outcome,
        pendingInjection: null,
        blockerStreak: attempts,
        blockerLastRunId: runId ?? null
      },
      PERSIST_BROADCAST
    )
  }
  return next(
    {
      ...goal,
      outcome,
      pendingInjection: null,
      blockerStreak: 0,
      blockerLastRunId: null
    },
    PERSIST_BROADCAST
  )
}

export function goalTransition(
  goal: ThreadGoal,
  event: GoalEvent
): Transition<ThreadGoal, GoalEffect> {
  switch (event.kind) {
    case 'objective-updated':
      return next(
        {
          ...goal,
          objective: event.objective,
          userState: 'active',
          outcome: null,
          limit: null,
          idleStreak: 0,
          blockerStreak: 0,
          blockerLastRunId: null,
          pendingInjection: 'objective_updated'
        },
        PERSIST_BROADCAST
      )

    case 'user-paused':
      return next({ ...goal, userState: 'paused', pendingInjection: null }, PERSIST_BROADCAST)

    case 'user-resumed':
      return next(resetForResume(goal), PERSIST_BROADCAST)

    case 'outcome-marked':
      return markOutcome(goal, event.outcome, event.runId)

    case 'usage-limited':
      if (goal.userState !== 'active' || goal.outcome || goal.limit) return stay(goal)
      return next({ ...goal, limit: 'usage', pendingInjection: null }, PERSIST_BROADCAST)

    case 'turn-evaluated':
      return evaluateTurn(goal, event.turn)

    default:
      return stay(goal)
  }
}
