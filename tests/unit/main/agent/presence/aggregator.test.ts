import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPresenceAggregator } from '@main/agent/presence/aggregator'
import type { PetPresencePayload } from '@shared/pet'

/**
 * Lifecycle / dispose coverage for the presence aggregator. Focuses on timer
 * cleanup and the broadcast de-duplication that drive the pet window, since
 * these are the parts most likely to leak or misfire during teardown.
 */
describe('agent/presence/aggregator — lifecycle', () => {
  let broadcasts: PetPresencePayload[]
  let running: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    broadcasts = []
    running = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function make() {
    return createPresenceAggregator({
      isAnyRunning: () => running,
      broadcast: (payload) => broadcasts.push(payload)
    })
  }

  it('starts idle and only broadcasts when the derived payload changes', () => {
    const agg = make()
    expect(agg.snapshot().state).toBe('idle')

    running = true
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'operation-start' } })
    expect(broadcasts.at(-1)?.state).toBe('thinking')

    const countAfterFirst = broadcasts.length
    // A second telemetry event that does not change the derived state must not re-broadcast.
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'step-start' } })
    expect(broadcasts.length).toBe(countAfterFirst)
  })

  it('surfaces a pending approval and clears it on the next step', () => {
    const agg = make()
    running = true
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'operation-start' } })

    agg.observeChunk('c1', {
      type: 'data-taskApproval',
      data: {
        rootChatId: 'c1',
        approvals: [{ approval: { approvalId: 'ap-1', toolName: 'shell' } }]
      }
    })
    expect(agg.snapshot().state).toBe('waiting-approval')
    expect(agg.snapshot().approval?.approvalId).toBe('ap-1')

    // A step-start for the same chat clears the approval.
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'step-start' } })
    expect(agg.snapshot().approval).toBeNull()
  })

  it('schedules a transient done window that expires via a timer', () => {
    const agg = make()
    running = true
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'operation-start' } })
    agg.observeText('c1', 'the answer')
    running = false
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'operation-finish' } })

    // Immediately after finish, we are in the transient "done" window with the reply.
    expect(agg.snapshot().state).toBe('done')
    expect(agg.snapshot().lastReply?.text).toBe('the answer')

    // After the done window elapses, the scheduled timer fires and we fall back to idle.
    vi.advanceTimersByTime(4000)
    expect(agg.snapshot().state).toBe('idle')
    expect(broadcasts.at(-1)?.state).toBe('idle')
  })

  it('dispose clears pending timers so no broadcast fires afterwards', () => {
    const agg = make()
    running = true
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'operation-start' } })
    running = false
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'operation-finish' } })
    // A done-window timer is now pending.
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    agg.dispose()
    expect(vi.getTimerCount()).toBe(0)

    const countAfterDispose = broadcasts.length
    vi.advanceTimersByTime(10_000)
    // No timer callback should run after dispose.
    expect(broadcasts.length).toBe(countAfterDispose)
  })

  it('dispose resets internal state back to idle', () => {
    const agg = make()
    running = true
    agg.observeChunk('c1', { type: 'data-telemetry', data: { event: 'tool-start' } })
    expect(agg.snapshot().state).toBe('running-tool')

    running = false
    agg.dispose()
    // With all maps cleared and nothing running, the derived state is idle again.
    expect(agg.snapshot().state).toBe('idle')
    expect(agg.snapshot().approval).toBeNull()
  })
})
