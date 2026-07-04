/**
 * Turn-loop decision core (pure). See the machine contract in ./machine/types.ts.
 *
 * v2: compaction is handled inline in prepareStep (see stream-runner), so the
 * only continuation path left is the plan-exit nudge.
 *
 *   stream-finished ─▶ decide ─┬─ plan-exit-retry  (re-prepare with a nudge)
 *                             └─ finalize          (terminate this turn)
 */
import type { AgentStreamFinalState } from './stream-runner'

export const MAX_PLAN_EXIT_PASSES = 2

export interface TurnDecisionContext {
  /** How many plan-exit nudges have been issued this turn. */
  planExitPasses: number
  /** Whether the conversation is in plan mode. */
  isPlanMode: boolean
  /** Whether another run is already inflight for this chat. */
  isInflight: boolean
  /** Whether the conversation still exists. */
  hasConversation: boolean
}

export type TurnDecision =
  | { kind: 'plan-exit-retry' }
  /** Terminate the turn. The loop runs terminal dispatch (queued messages /
   *  goal continuation) exactly once for this decision. */
  | { kind: 'finalize' }

export function decideTurnOutcome(
  state: AgentStreamFinalState,
  ctx: TurnDecisionContext
): TurnDecision {
  const live = !state.aborted && !state.streamFailed && !ctx.isInflight && ctx.hasConversation

  const planModeNeedsExitCall =
    live &&
    state.endedWithTextOnly &&
    !state.exitPlanModeCalled &&
    ctx.isPlanMode &&
    ctx.planExitPasses < MAX_PLAN_EXIT_PASSES
  if (planModeNeedsExitCall) return { kind: 'plan-exit-retry' }

  return { kind: 'finalize' }
}
