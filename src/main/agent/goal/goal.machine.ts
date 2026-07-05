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
 * Rules live here, not in prose (invariant I2): the block threshold
 * (BLOCK_ATTEMPTS_REQUIRED) is enforced by the machine — tool descriptions and
 * templates merely reference it. Every turn decision carries a reason so the
 * interpreter/UI can explain why continuation stopped.
 *
 * `transition` is pure: it never reads the clock, randomness, or I/O. The
 * interpreter (goal/service.ts) stamps `updatedAt` and performs persistence /
 * broadcast based on the returned effects.
 */
import type { GoalDecisionReason, GoalInjection, GoalOutcome, ThreadGoal } from '@shared/goal'
import { next, stay, type Transition } from '../runtime/machine/types'

export const IDLE_STREAK_LIMIT = 2

/** Block attempts required before `blocked` sticks. Single source of truth —
 *  referenced by the updateGoal tool description and goal templates. */
export const BLOCK_ATTEMPTS_REQUIRED = 3

export interface GoalTurnInput {
  isGoalContinuation: boolean
  /** Did the worktree actually change this turn? null = signal unavailable. */
  worktreeChanged: boolean | null
  /** Fallback signal: an edit/exec-kind tool call ran this turn. */
  producedWorkToolCall: boolean
  turnTokens: number
  turnSeconds: number
  isPlanMode: boolean
  suppressContinuation: boolean
  /** False for failed/aborted turns: account tokens, never continue. */
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

/**
 * Work evidence (invariant I5): trust the worktree diff when available; fall
 * back to the (corrected) tool-kind signal only when no diff could be taken.
 * A turn with a verified-unchanged worktree counts as idle even if exec-kind
 * tools ran — `ls` loops no longer reset the streak.
 */
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
    // A turn with real work evidence breaks the "same blocker persists" streak.
    blockerStreak: workEvidence ? 0 : goal.blockerStreak
  }

  const decided = (
    state: ThreadGoal,
    cont: boolean,
    reason: GoalDecisionReason
  ): Transition<ThreadGoal, GoalEffect> =>
    next(state, [...PERSIST_BROADCAST, { kind: 'decision', continue: cont, reason }])

  // Accounting is always persisted, even for non-active or failed turns.
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
    // Same-run dedupe: a repeated blocked call within one run neither
    // increments the streak nor changes the answer.
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
