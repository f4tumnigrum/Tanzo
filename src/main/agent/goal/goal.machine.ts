/**
 * Goal state machine (pure core). See the machine contract in ../runtime/machine/types.ts.
 *
 * State graph (status derived via deriveStatus):
 *
 *   active ──user-paused──▶ paused ──user-resumed──▶ active
 *      │                                               ▲
 *      ├─turn-evaluated(budget)─▶ budget_limited ──────┘ (resume)
 *      ├─usage-limited─────────▶ usage_limited ─────────┘ (resume)
 *      ├─outcome-marked────────▶ complete | blocked ────┘ (resume/objective)
 *      └─objective-updated─────▶ active (reset)
 *
 * `transition` is pure: it never reads the clock, randomness, or I/O. The
 * interpreter (goal/service.ts) stamps `updatedAt` and performs persistence /
 * broadcast based on the returned effects.
 */
import type { GoalInjection, GoalOutcome, ThreadGoal } from '@shared/goal'
import { next, stay, type Transition } from '../runtime/machine/types'

export const IDLE_STREAK_LIMIT = 2

export interface GoalTurnInput {
  isGoalContinuation: boolean
  producedWorkToolCall: boolean
  turnTokens: number
  turnSeconds: number
  isPlanMode: boolean
  suppressContinuation: boolean
}

export type GoalEvent =
  | { kind: 'objective-updated'; objective: string }
  | { kind: 'user-paused' }
  | { kind: 'user-resumed' }
  | { kind: 'turn-evaluated'; turn: GoalTurnInput }
  | { kind: 'outcome-marked'; outcome: GoalOutcome }
  | { kind: 'usage-limited' }

export type GoalEffect =
  | { kind: 'persist' }
  | { kind: 'broadcast' }
  | { kind: 'decision'; continue: boolean }

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
    pendingInjection: 'continuation'
  }
}

function evaluateTurn(goal: ThreadGoal, turn: GoalTurnInput): Transition<ThreadGoal, GoalEffect> {
  const idleStreak = !turn.isGoalContinuation
    ? 0
    : turn.producedWorkToolCall
      ? 0
      : goal.idleStreak + 1

  const accounted: ThreadGoal = {
    ...goal,
    tokensUsed: goal.tokensUsed + Math.max(0, turn.turnTokens),
    timeUsedSeconds: goal.timeUsedSeconds + Math.max(0, turn.turnSeconds),
    idleStreak
  }

  const decided = (state: ThreadGoal, cont: boolean): Transition<ThreadGoal, GoalEffect> =>
    next(state, [...PERSIST_BROADCAST, { kind: 'decision', continue: cont }])

  // Accounting is always persisted, even for non-active goals.
  if (accounted.userState !== 'active' || accounted.outcome || accounted.limit) {
    return decided(accounted, false)
  }

  if (isBudgetExhausted(accounted)) {
    const wrapUp = !turn.isPlanMode && !turn.suppressContinuation
    const limited: ThreadGoal = { ...accounted, limit: 'budget', pendingInjection: 'budget_limit' }
    return decided(limited, wrapUp)
  }

  if (turn.isPlanMode || turn.suppressContinuation) return decided(accounted, false)
  if (idleStreak >= IDLE_STREAK_LIMIT) return decided(accounted, false)

  return decided(withInjection(accounted, 'continuation'), true)
}

/**
 * Pure transition for an existing goal. Lifecycle concerns that throw or return
 * null (create, no-goal guards) live in the interpreter, not here.
 */
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
          pendingInjection: 'objective_updated'
        },
        PERSIST_BROADCAST
      )

    case 'user-paused':
      return next({ ...goal, userState: 'paused', pendingInjection: null }, PERSIST_BROADCAST)

    case 'user-resumed':
      return next(resetForResume(goal), PERSIST_BROADCAST)

    case 'outcome-marked':
      return next(
        {
          ...goal,
          outcome: event.outcome,
          pendingInjection: null,
          blockerStreak: event.outcome === 'blocked' ? goal.blockerStreak + 1 : 0
        },
        PERSIST_BROADCAST
      )

    case 'usage-limited':
      if (goal.userState !== 'active' || goal.outcome || goal.limit) return stay(goal)
      return next({ ...goal, limit: 'usage', pendingInjection: null }, PERSIST_BROADCAST)

    case 'turn-evaluated':
      return evaluateTurn(goal, event.turn)

    default:
      return stay(goal)
  }
}
