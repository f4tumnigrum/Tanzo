import { describe, expect, it } from 'vitest'
import { BLOCK_ATTEMPTS_REQUIRED, goalTransition } from '@main/agent/goal/goal.machine'
import type { ThreadGoal } from '@shared/goal'

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    chatId: 'c1',
    objective: 'X',
    userState: 'active',
    outcome: null,
    limit: null,
    tokenBudget: null,
    tokensUsed: 0,
    timeBudgetSeconds: null,
    timeUsedSeconds: 0,
    idleStreak: 0,
    blockerStreak: 0,
    blockerLastRunId: null,
    pendingInjection: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

const TURN = {
  isGoalContinuation: false,
  worktreeChanged: null,
  producedWorkToolCall: true,
  turnTokens: 10,
  turnSeconds: 1,
  isPlanMode: false,
  suppressContinuation: false,
  outcomeEligible: true
}

describe('agent/goal/goal.machine', () => {
  it('is pure: does not mutate the input state', () => {
    const before = goal()
    const snapshot = structuredClone(before)
    goalTransition(before, { kind: 'turn-evaluated', turn: TURN })
    expect(before).toEqual(snapshot)
  })

  it('continues an active goal and arms a continuation injection', () => {
    const result = goalTransition(goal(), { kind: 'turn-evaluated', turn: TURN })
    expect(result.state.pendingInjection).toBe('continuation')
    expect(result.effects).toContainEqual({
      kind: 'decision',
      continue: true,
      reason: 'continue'
    })
  })

  it('flips to budget_limited and still wraps up when not suppressed', () => {
    const result = goalTransition(goal({ tokenBudget: 5 }), {
      kind: 'turn-evaluated',
      turn: { ...TURN, turnTokens: 6 }
    })
    expect(result.state.limit).toBe('budget')
    expect(result.state.pendingInjection).toBe('budget_limit')
    expect(result.effects).toContainEqual({ kind: 'decision', continue: true, reason: 'wrap-up' })
  })

  it('accounts but never continues a non-active goal (illegal continuation)', () => {
    const paused = goal({ userState: 'paused' })
    const result = goalTransition(paused, { kind: 'turn-evaluated', turn: TURN })
    expect(result.state.tokensUsed).toBe(10) // accounting still applied
    expect(result.effects).toContainEqual({
      kind: 'decision',
      continue: false,
      reason: 'not-active'
    })
    expect(result.state.pendingInjection).toBeNull()
  })

  it('accounts but never continues a failed/aborted turn', () => {
    const result = goalTransition(goal(), {
      kind: 'turn-evaluated',
      turn: { ...TURN, outcomeEligible: false }
    })
    expect(result.state.tokensUsed).toBe(10)
    expect(result.effects).toContainEqual({
      kind: 'decision',
      continue: false,
      reason: 'not-active'
    })
  })

  it('treats a verified-unchanged worktree as idle despite exec tool calls', () => {
    const result = goalTransition(goal({ idleStreak: 0 }), {
      kind: 'turn-evaluated',
      turn: {
        ...TURN,
        isGoalContinuation: true,
        worktreeChanged: false,
        producedWorkToolCall: true
      }
    })
    expect(result.state.idleStreak).toBe(1)
  })

  it('treats usage-limited on a completed goal as a no-op', () => {
    const done = goal({ outcome: 'complete' })
    const result = goalTransition(done, { kind: 'usage-limited' })
    expect(result.state).toBe(done)
    expect(result.effects).toEqual([])
  })

  it('resets streaks and re-arms continuation on resume', () => {
    const paused = goal({ userState: 'paused', idleStreak: 2, blockerStreak: 1 })
    const result = goalTransition(paused, { kind: 'user-resumed' })
    expect(result.state.userState).toBe('active')
    expect(result.state.idleStreak).toBe(0)
    expect(result.state.blockerStreak).toBe(0)
    expect(result.state.pendingInjection).toBe('continuation')
  })

  it('rejects blocked below the attempt threshold and records the attempt', () => {
    const result = goalTransition(goal(), {
      kind: 'outcome-marked',
      outcome: 'blocked',
      runId: 'run-1'
    })
    expect(result.state.outcome).toBeNull()
    expect(result.state.blockerStreak).toBe(1)
    expect(result.state.blockerLastRunId).toBe('run-1')
    expect(result.effects).toContainEqual({
      kind: 'reject',
      code: 'blocked-too-early',
      attempts: 1,
      required: BLOCK_ATTEMPTS_REQUIRED
    })
  })

  it('does not double-count blocked attempts within one run', () => {
    const once = goalTransition(goal({ blockerStreak: 1, blockerLastRunId: 'run-1' }), {
      kind: 'outcome-marked',
      outcome: 'blocked',
      runId: 'run-1'
    })
    expect(once.state.blockerStreak).toBe(1)
    expect(once.state.outcome).toBeNull()
  })

  it('applies blocked once the attempt threshold is reached', () => {
    const result = goalTransition(
      goal({ blockerStreak: BLOCK_ATTEMPTS_REQUIRED - 1, blockerLastRunId: 'run-2' }),
      { kind: 'outcome-marked', outcome: 'blocked', runId: 'run-3' }
    )
    expect(result.state.outcome).toBe('blocked')
    expect(result.state.blockerStreak).toBe(BLOCK_ATTEMPTS_REQUIRED)
  })

  it('complete clears the blocker streak and applies immediately', () => {
    const result = goalTransition(goal({ blockerStreak: 2, blockerLastRunId: 'run-1' }), {
      kind: 'outcome-marked',
      outcome: 'complete'
    })
    expect(result.state.outcome).toBe('complete')
    expect(result.state.blockerStreak).toBe(0)
    expect(result.state.blockerLastRunId).toBeNull()
  })
})
