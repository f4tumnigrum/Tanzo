import { describe, expect, it, vi } from 'vitest'
import type { SqlDatabase } from '@main/database/types'
import { createGoalStore } from '@main/agent/goal/store'
import { createGoalService } from '@main/agent/goal/service'
import { BLOCK_ATTEMPTS_REQUIRED } from '@main/agent/goal/goal.machine'
import { deriveStatus } from '@shared/goal'

function fakeDb(): SqlDatabase {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    exec: () => undefined,
    prepare: (sql: string) => ({
      run(params?: Record<string, unknown> | unknown[]) {
        if (sql.includes('INSERT') && params && !Array.isArray(params)) {
          rows.set(String(params.conversation_id), { ...params })
        } else if (sql.startsWith('DELETE') && Array.isArray(params)) {
          rows.delete(String(params[0]))
        }
      },
      get: (params?: Record<string, unknown> | unknown[]) =>
        sql.startsWith('SELECT') && Array.isArray(params)
          ? (rows.get(String(params[0])) ?? undefined)
          : undefined,
      all: () => []
    }),
    transaction: <T>(fn: () => T): T => fn(),
    pragma: () => undefined,
    close: () => undefined
  }
}

function setup() {
  const store = createGoalStore(fakeDb())
  const broadcast = vi.fn()
  const service = createGoalService({ store, broadcast })
  return { store, broadcast, service }
}

const USER_TURN = {
  isGoalContinuation: false,
  worktreeChanged: null,
  producedWorkToolCall: true,
  turnTokens: 100,
  turnSeconds: 1,
  isPlanMode: false,
  suppressContinuation: false,
  outcomeEligible: true
}

const CONT_TURN = { ...USER_TURN, isGoalContinuation: true }

/** Drive the goal to a sticky blocked outcome across distinct runs. */
function blockUntilApplied(service: ReturnType<typeof setup>['service'], chatId: string): void {
  for (let i = 0; i < BLOCK_ATTEMPTS_REQUIRED; i += 1) {
    service.markOutcome(chatId, 'blocked', { runId: `run-${i}` })
  }
}

describe('agent/goal/service', () => {
  it('creates an active goal, broadcasts, and queues a continuation injection', () => {
    const { service, broadcast } = setup()
    const goal = service.create('c1', { objective: 'Do the thing' })
    expect(deriveStatus(goal)).toBe('active')
    expect(broadcast).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ objective: 'Do the thing' })
    )
    expect(service.takeInjection('c1')).toBe('continuation')
  })

  it('rejects duplicate or blank goal creation', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    expect(() => service.create('c1', { objective: 'Y' })).toThrow(/already has a goal/)
    expect(() => service.create('c2', { objective: '   ' })).toThrow(/objective is required/i)
  })

  it('continues an active goal after a productive turn', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.takeInjection('c1')
    const decision = service.evaluate('c1', USER_TURN)
    expect(decision).toEqual({ continue: true, reason: 'continue' })
    expect(service.takeInjection('c1')).toBe('continuation')
  })

  it('allows one idle continuation (verification) but stops after the second', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    expect(service.evaluate('c1', USER_TURN).continue).toBe(true)
    const first = service.evaluate('c1', { ...CONT_TURN, producedWorkToolCall: false })
    expect(first.continue).toBe(true)
    expect(service.get('c1')?.idleStreak).toBe(1)
    const second = service.evaluate('c1', { ...CONT_TURN, producedWorkToolCall: false })
    expect(second).toEqual({ continue: false, reason: 'idle-limit' })
    expect(service.get('c1')?.idleStreak).toBe(2)
  })

  it('stops after two continuations that only used meta tools', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    expect(service.evaluate('c1', { ...CONT_TURN, producedWorkToolCall: false }).continue).toBe(
      true
    )
    const decision = service.evaluate('c1', { ...CONT_TURN, producedWorkToolCall: false })
    expect(decision.continue).toBe(false)
  })

  it('resets the idle streak when a continuation does real work', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.evaluate('c1', { ...CONT_TURN, producedWorkToolCall: false })
    expect(service.get('c1')?.idleStreak).toBe(1)
    service.evaluate('c1', { ...CONT_TURN, producedWorkToolCall: true })
    expect(service.get('c1')?.idleStreak).toBe(0)
  })

  it('trusts a verified-unchanged worktree over exec tool calls (idle)', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    // exec tools ran, but the worktree diff proves nothing changed → idle.
    service.evaluate('c1', { ...CONT_TURN, worktreeChanged: false, producedWorkToolCall: true })
    expect(service.get('c1')?.idleStreak).toBe(1)
    const second = service.evaluate('c1', {
      ...CONT_TURN,
      worktreeChanged: false,
      producedWorkToolCall: true
    })
    expect(second).toEqual({ continue: false, reason: 'idle-limit' })
  })

  it('trusts a changed worktree even without work tool calls', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.evaluate('c1', { ...CONT_TURN, worktreeChanged: true, producedWorkToolCall: false })
    expect(service.get('c1')?.idleStreak).toBe(0)
  })

  it('treats an idle user turn as fresh activity, not suppression', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    const decision = service.evaluate('c1', { ...USER_TURN, producedWorkToolCall: false })
    expect(decision.continue).toBe(true)
    expect(service.get('c1')?.idleStreak).toBe(0)
  })

  it('does not continue in plan mode', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    const decision = service.evaluate('c1', { ...USER_TURN, isPlanMode: true })
    expect(decision).toEqual({ continue: false, reason: 'plan-mode' })
  })

  it('accounts a turn without continuing when continuation is suppressed', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.takeInjection('c1')
    const decision = service.evaluate('c1', { ...USER_TURN, suppressContinuation: true })
    expect(decision).toEqual({ continue: false, reason: 'queued-message' })
    expect(service.get('c1')?.tokensUsed).toBe(100)
    expect(service.takeInjection('c1')).toBeNull()
  })

  it('accounts failed/aborted turns but never continues them', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    const decision = service.evaluate('c1', { ...USER_TURN, outcomeEligible: false })
    expect(decision.continue).toBe(false)
    expect(service.get('c1')?.tokensUsed).toBe(100)
  })

  it('flips to budget_limited when the token budget is exhausted', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X', tokenBudget: 50 })
    const decision = service.evaluate('c1', { ...USER_TURN, turnTokens: 60 })
    const goal = service.get('c1')
    expect(goal && deriveStatus(goal)).toBe('budget_limited')
    expect(decision).toEqual({ continue: true, reason: 'wrap-up' })
    expect(service.takeInjection('c1')).toBe('budget_limit')
  })

  it('flips to budget_limited when the time budget is exhausted', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X', timeBudgetSeconds: 10 })
    service.evaluate('c1', { ...USER_TURN, turnSeconds: 15 })
    const goal = service.get('c1')
    expect(goal && deriveStatus(goal)).toBe('budget_limited')
  })

  it('does not schedule a wrap-up continuation when suppressed at budget limit', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X', tokenBudget: 50 })
    const decision = service.evaluate('c1', {
      ...USER_TURN,
      turnTokens: 60,
      suppressContinuation: true
    })
    expect(decision).toEqual({ continue: false, reason: 'budget-exhausted' })
    expect(service.takeInjection('c1')).toBe('budget_limit')
  })

  it('marks usage_limited and stops continuing', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.markUsageLimited('c1')
    const goal = service.get('c1')
    expect(goal && deriveStatus(goal)).toBe('usage_limited')
    expect(service.evaluate('c1', USER_TURN).continue).toBe(false)
  })

  it('injects objective_updated after the objective changes', () => {
    const { service } = setup()
    service.create('c1', { objective: 'old' })
    service.takeInjection('c1')
    service.updateObjective('c1', 'new')
    expect(service.get('c1')?.objective).toBe('new')
    expect(service.takeInjection('c1')).toBe('objective_updated')
  })

  it('re-arms a continuation injection when a paused goal is resumed', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.setUserState('c1', 'paused')
    expect(deriveStatus(service.get('c1')!)).toBe('paused')
    service.setUserState('c1', 'active')
    expect(deriveStatus(service.get('c1')!)).toBe('active')
    expect(service.takeInjection('c1')).toBe('continuation')
  })

  it('clears the goal and broadcasts null', () => {
    const { service, broadcast } = setup()
    service.create('c1', { objective: 'X' })
    broadcast.mockClear()
    service.clear('c1')
    expect(service.get('c1')).toBeNull()
    expect(broadcast).toHaveBeenCalledWith('c1', null)
  })

  it('markOutcome applies complete immediately', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    const completed = service.markOutcome('c1', 'complete')
    expect(completed.kind).toBe('applied')
    expect(deriveStatus(service.get('c1')!)).toBe('complete')
    expect(service.markOutcome('missing', 'blocked')).toEqual({ kind: 'no-goal' })
  })

  it('rejects blocked until the attempt threshold is reached', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    for (let i = 1; i < BLOCK_ATTEMPTS_REQUIRED; i += 1) {
      const result = service.markOutcome('c1', 'blocked', { runId: `run-${i}` })
      expect(result).toEqual({
        kind: 'rejected',
        code: 'blocked-too-early',
        attempts: i,
        required: BLOCK_ATTEMPTS_REQUIRED
      })
      expect(deriveStatus(service.get('c1')!)).toBe('active')
    }
    const final = service.markOutcome('c1', 'blocked', { runId: 'run-final' })
    expect(final.kind).toBe('applied')
    expect(deriveStatus(service.get('c1')!)).toBe('blocked')
  })

  it('deduplicates repeated blocked calls within the same run', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.markOutcome('c1', 'blocked', { runId: 'run-1' })
    const repeat = service.markOutcome('c1', 'blocked', { runId: 'run-1' })
    expect(repeat).toEqual({
      kind: 'rejected',
      code: 'blocked-too-early',
      attempts: 1,
      required: BLOCK_ATTEMPTS_REQUIRED
    })
    expect(service.get('c1')?.blockerStreak).toBe(1)
  })

  it('clears the blocker streak when a turn shows work evidence', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.markOutcome('c1', 'blocked', { runId: 'run-1' })
    service.markOutcome('c1', 'blocked', { runId: 'run-2' })
    expect(service.get('c1')?.blockerStreak).toBe(2)
    // A turn with real work resets the streak — the blocker did not persist.
    service.evaluate('c1', { ...CONT_TURN, worktreeChanged: true })
    expect(service.get('c1')?.blockerStreak).toBe(0)
    const afterWork = service.markOutcome('c1', 'blocked', { runId: 'run-3' })
    expect(afterWork.kind).toBe('rejected')
  })

  it('stops continuing once the model marks the goal complete', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    service.markOutcome('c1', 'complete')
    const decision = service.evaluate('c1', USER_TURN)
    expect(decision).toEqual({ continue: false, reason: 'not-active' })
  })

  it('stops continuing once blocked sticks', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    blockUntilApplied(service, 'c1')
    expect(deriveStatus(service.get('c1')!)).toBe('blocked')
    expect(service.evaluate('c1', USER_TURN).continue).toBe(false)
  })

  it('resume after blocked resets the blocker streak', () => {
    const { service } = setup()
    service.create('c1', { objective: 'X' })
    blockUntilApplied(service, 'c1')
    service.setUserState('c1', 'active')
    expect(service.get('c1')?.blockerStreak).toBe(0)
    expect(service.get('c1')?.blockerLastRunId).toBeNull()
    const result = service.markOutcome('c1', 'blocked', { runId: 'run-x' })
    expect(result.kind).toBe('rejected')
  })
})
