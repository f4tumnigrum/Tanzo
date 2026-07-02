/**
 * Turn-loop decision core (pure). See the machine contract in ./machine/types.ts.
 *
 * After a chat stream finishes, exactly one of four continuation paths applies.
 * The decision is a priority cascade over the final stream state plus a snapshot
 * of loop/runtime counters. Keeping it pure means it can be table-tested without
 * mocking the model stream (the documented primary win for Phase 2).
 *
 *   stream-finished ─▶ decide ─┬─ plan-exit-retry  (re-prepare with a nudge)
 *                             ├─ compaction-retry (re-prepare, force compaction)
 *                             ├─ post-compact     (compact, then terminate)
 *                             └─ finalize         (terminate this turn)
 *
 * Note: plan-exit-retry and compaction-retry are mutually exclusive because
 * `endedWithTextOnly` (no tool call in the last step) implies
 * `!hitCompactionTrigger` (which requires a tool call in the last step), so a
 * single runtime snapshot faithfully drives the cascade.
 */
import type { AgentStreamFinalState } from './stream-runner'

export const MAX_CONTINUATION_PASSES = 10
export const MAX_PLAN_EXIT_PASSES = 2

export interface TurnDecisionContext {
  /** Continuation pass index (compaction retries). */
  pass: number
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
  | { kind: 'compaction-retry' }
  | { kind: 'post-compact' }
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

  const canContinueAfterCompaction =
    live && state.hitCompactionTrigger && ctx.pass < MAX_CONTINUATION_PASSES
  if (canContinueAfterCompaction) return { kind: 'compaction-retry' }

  const shouldPostCompact =
    !state.aborted &&
    !state.streamFailed &&
    state.exceededCompactionTrigger &&
    !state.hitCompactionTrigger &&
    !ctx.isInflight
  if (shouldPostCompact) return { kind: 'post-compact' }

  return { kind: 'finalize' }
}
