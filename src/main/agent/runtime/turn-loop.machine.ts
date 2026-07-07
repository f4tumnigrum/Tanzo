import type { AgentStreamFinalState } from './stream-runner'

export const MAX_PLAN_EXIT_PASSES = 2

export interface TurnDecisionContext {
  planExitPasses: number

  isPlanMode: boolean

  isInflight: boolean

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
