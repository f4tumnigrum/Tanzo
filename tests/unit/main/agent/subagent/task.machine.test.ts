import { describe, expect, it } from 'vitest'
import { isTaskTerminal, taskTransition } from '@main/agent/subagent/task.machine'
import type { SubagentTask } from '@shared/subagent-task'

function task(overrides: Partial<SubagentTask> = {}): SubagentTask {
  return {
    id: 'explore-1',
    chatId: 'child',
    parentChatId: 'root',
    rootChatId: 'root',
    agentType: 'explore',
    objective: 'inspect',
    status: 'running',
    dependsOn: [],
    allowedTools: null,
    phases: [],
    notes: [],
    createdAt: 1,
    ...overrides
  }
}

describe('agent/subagent/task.machine', () => {
  it('is pure: does not mutate the input task', () => {
    const before = task({ block: { kind: 'approval', approvals: [] } })
    const snapshot = structuredClone(before)
    taskTransition(before, { kind: 'complete', summary: 'ok', now: 5 })
    expect(before).toEqual(snapshot)
  })

  it('completes a running task, clears block, and notifies awaiters', () => {
    const result = taskTransition(task(), { kind: 'complete', summary: 'done', now: 9 })
    expect(result.state.status).toBe('done')
    expect(result.state.completedAt).toBe(9)
    expect(result.state.result).toEqual({ summary: 'done' })
    expect(result.effects).toEqual([{ kind: 'persist' }, { kind: 'notify-settled' }])
  })

  it('treats completing an already-terminal task as a no-op', () => {
    const done = task({ status: 'done' })
    const result = taskTransition(done, { kind: 'complete', summary: 'x', now: 1 })
    expect(result.state).toBe(done)
    expect(result.effects).toEqual([])
  })

  it('surfaces and clears an approval block', () => {
    const surfaced = taskTransition(task(), {
      kind: 'surface-approvals',
      approvals: [{ approvalId: 'a1', toolName: 'shell', input: {} }]
    })
    expect(surfaced.state.status).toBe('blocked')
    expect(surfaced.state.block).toEqual({
      kind: 'approval',
      approvals: [{ approvalId: 'a1', toolName: 'shell', input: {} }]
    })

    const cleared = taskTransition(surfaced.state, { kind: 'clear-approval-block' })
    expect(cleared.state.status).toBe('running')
    expect(cleared.state.block).toBeUndefined()
  })

  it('appends notes while active and ignores them once terminal', () => {
    const active = taskTransition(task(), { kind: 'add-note', note: 'found a surprise', now: 4 })
    expect(active.state.notes).toEqual([{ text: 'found a surprise', at: 4 }])
    expect(active.effects).toEqual([{ kind: 'persist' }])

    const done = task({ status: 'done' })
    const ignored = taskTransition(done, { kind: 'add-note', note: 'late', now: 9 })
    expect(ignored.state).toBe(done)
    expect(ignored.effects).toEqual([])
  })

  it('carries notes into the result on complete and clears them on redefine', () => {
    const withNotes = task({ notes: [{ text: 'n1', at: 2 }] })
    const completed = taskTransition(withNotes, {
      kind: 'complete',
      summary: 'done',
      resultSource: 'explicit',
      notes: withNotes.notes,
      now: 9
    })
    expect(completed.state.result).toEqual({
      summary: 'done',
      resultSource: 'explicit',
      notes: [{ text: 'n1', at: 2 }]
    })

    const redefined = taskTransition(withNotes, { kind: 'redefine', objective: 'new', now: 10 })
    expect(redefined.state.notes).toEqual([])
  })

  it('does not clear a non-approval block', () => {
    const blocked = task({ status: 'pending', block: { kind: 'dependency', taskIds: ['x'] } })
    const result = taskTransition(blocked, { kind: 'clear-approval-block' })
    expect(result.state).toBe(blocked)
    expect(result.effects).toEqual([])
  })

  it('only retries from a terminal failed/cancelled state', () => {
    const running = taskTransition(task({ status: 'running' }), { kind: 'retry', now: 3 })
    expect(running.effects).toEqual([])

    const failed = taskTransition(
      task({ status: 'failed', result: { summary: '', failed: true } }),
      {
        kind: 'retry',
        now: 3
      }
    )
    expect(failed.state.status).toBe('running')
    expect(failed.state.result).toBeUndefined()
    expect(failed.state.phases).toEqual([])
  })

  it('redefine resets objective, phases, and result', () => {
    const result = taskTransition(task({ phases: [{ name: 'p', at: 1 }] }), {
      kind: 'redefine',
      objective: 'new goal',
      now: 7
    })
    expect(result.state.objective).toBe('new goal')
    expect(result.state.status).toBe('running')
    expect(result.state.phases).toEqual([])
  })

  it('resume and redefine are no-ops on terminal tasks (results are final)', () => {
    for (const status of ['done', 'failed', 'cancelled'] as const) {
      const settled = task({ status, result: { summary: 'final' } })
      const resumed = taskTransition(settled, { kind: 'resume', now: 5 })
      expect(resumed.state).toBe(settled)
      expect(resumed.effects).toEqual([])
      const redefined = taskTransition(settled, { kind: 'redefine', objective: 'again', now: 5 })
      expect(redefined.state).toBe(settled)
      expect(redefined.effects).toEqual([])
    }
  })

  it('resume does not bypass the dependency gate', () => {
    const gated = task({ status: 'pending', block: { kind: 'dependency', taskIds: ['a-1'] } })
    const result = taskTransition(gated, { kind: 'resume', now: 5 })
    expect(result.state).toBe(gated)
    expect(result.effects).toEqual([])
  })

  it('resume still restarts an approval-blocked task', () => {
    const blocked = task({
      status: 'blocked',
      block: { kind: 'approval', approvals: [{ approvalId: 'a1', toolName: 'shell', input: {} }] }
    })
    const result = taskTransition(blocked, { kind: 'resume', now: 5 })
    expect(result.state.status).toBe('running')
    expect(result.state.block).toBeUndefined()
  })

  it('appends phases without dropping prior ones', () => {
    const first = taskTransition(task(), { kind: 'set-phase', phase: 'reading', now: 2 })
    const second = taskTransition(first.state, { kind: 'set-phase', phase: 'writing', now: 4 })
    expect(second.state.phase).toBe('writing')
    expect(second.state.phases).toEqual([
      { name: 'reading', at: 2 },
      { name: 'writing', at: 4 }
    ])
  })

  it('ignores a late set-result after the task reached a terminal state', () => {
    const done = task({ status: 'done', result: { summary: 'final', resultSource: 'inferred' } })
    const result = taskTransition(done, {
      kind: 'set-result',
      result: { summary: 'late overwrite' }
    })
    expect(result.state).toBe(done)
    expect(result.effects).toEqual([])
    expect(done.result).toEqual({ summary: 'final', resultSource: 'inferred' })
  })

  it('applies set-result while the task is still running', () => {
    const result = taskTransition(task(), { kind: 'set-result', result: { summary: 'progress' } })
    expect(result.state.result).toEqual({ summary: 'progress' })
    expect(result.effects).toEqual([{ kind: 'persist' }])
  })

  it('exposes a terminal predicate matching done/failed/cancelled', () => {
    expect(isTaskTerminal('done')).toBe(true)
    expect(isTaskTerminal('failed')).toBe(true)
    expect(isTaskTerminal('cancelled')).toBe(true)
    expect(isTaskTerminal('running')).toBe(false)
    expect(isTaskTerminal('pending')).toBe(false)
    expect(isTaskTerminal('blocked')).toBe(false)
  })
})
