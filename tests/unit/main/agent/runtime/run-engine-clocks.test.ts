import { describe, expect, it } from 'vitest'
import { createRunEngine } from '@main/agent/runtime/run-engine'

/**
 * Characterization tests for the RunEngine "generation clock" behavior.
 *
 * These pin the CURRENT observable semantics of the two independent clocks
 * (`epoch` and `cancelGeneration`) and the per-chat registries, so that the
 * Phase 1 reconciliation of these clocks is a deliberate, visible change and
 * not a silent regression. They intentionally assert today's behavior — some
 * of these assertions are expected to be updated when the clocks are unified.
 */
describe('agent/runtime/run-engine — clock interaction characterization', () => {
  it('beginRun advances epoch but never touches cancelGeneration', () => {
    const engine = createRunEngine()
    expect(engine.currentEpoch('c1')).toBe(0)
    expect(engine.currentCancelGeneration('c1')).toBe(0)

    engine.beginRun('c1')
    expect(engine.currentEpoch('c1')).toBe(1)
    expect(engine.currentCancelGeneration('c1')).toBe(0)

    engine.beginRun('c1')
    expect(engine.currentEpoch('c1')).toBe(2)
    expect(engine.currentCancelGeneration('c1')).toBe(0)
  })

  it('bumpCancelGeneration advances the cancel clock but never touches the epoch', () => {
    const engine = createRunEngine()
    engine.beginRun('c1')
    const epochAfterBegin = engine.currentEpoch('c1')

    expect(engine.bumpCancelGeneration('c1')).toBe(1)
    expect(engine.bumpCancelGeneration('c1')).toBe(2)
    // The two clocks are currently fully decoupled: cancelling does not advance epoch.
    expect(engine.currentEpoch('c1')).toBe(epochAfterBegin)
  })

  it('abort advances epoch as a side effect, even with no active run', () => {
    const engine = createRunEngine()
    // No beginRun / setPreparing — abort still bumps the epoch clock.
    expect(engine.currentEpoch('c1')).toBe(0)
    engine.abort('c1')
    expect(engine.currentEpoch('c1')).toBe(1)
    // And it does not touch the cancel clock.
    expect(engine.currentCancelGeneration('c1')).toBe(0)
  })

  it('hasAdvancedSince reflects only the epoch clock, not the cancel clock', () => {
    const engine = createRunEngine()
    const run = engine.beginRun('c1')
    expect(engine.hasAdvancedSince('c1', run.epoch)).toBe(false)

    // Bumping the cancel generation does NOT make hasAdvancedSince report advancement.
    engine.bumpCancelGeneration('c1')
    expect(engine.hasAdvancedSince('c1', run.epoch)).toBe(false)

    // Only an epoch-advancing event (begin/abort) does.
    engine.abort('c1')
    expect(engine.hasAdvancedSince('c1', run.epoch)).toBe(true)
  })

  it('keeps epoch and cancelGeneration isolated per chat', () => {
    const engine = createRunEngine()
    engine.beginRun('c1')
    engine.beginRun('c1')
    engine.bumpCancelGeneration('c1')

    expect(engine.currentEpoch('c1')).toBe(2)
    expect(engine.currentCancelGeneration('c1')).toBe(1)
    // Untouched chat stays at the zero baseline for both clocks.
    expect(engine.currentEpoch('c2')).toBe(0)
    expect(engine.currentCancelGeneration('c2')).toBe(0)
  })

  it('currentController tracks the inflight owner and clears on release', () => {
    const engine = createRunEngine()
    expect(engine.currentController('c1')).toBeUndefined()

    const first = engine.beginRun('c1')
    expect(engine.currentController('c1')).toBe(first.controller)

    // A second begin aborts and replaces the first as the current controller.
    const second = engine.beginRun('c1')
    expect(first.controller.signal.aborted).toBe(true)
    expect(engine.currentController('c1')).toBe(second.controller)

    engine.releaseIfOwner('c1', second.controller)
    expect(engine.currentController('c1')).toBeUndefined()
  })

  it('setPreparing marks running before any inflight run and abort cancels it', () => {
    const engine = createRunEngine()
    const prep = new AbortController()
    engine.setPreparing('c1', prep)
    expect(engine.isRunning('c1')).toBe(true)
    // No inflight controller yet — only the preparing slot.
    expect(engine.currentController('c1')).toBeUndefined()

    engine.abort('c1')
    expect(prep.signal.aborted).toBe(true)
    // abort does not itself remove the preparing entry; clearPreparing owns that.
    engine.clearPreparing('c1', prep)
    expect(engine.isRunning('c1')).toBe(false)
  })

  it('clearPreparing only clears the matching controller', () => {
    const engine = createRunEngine()
    const first = new AbortController()
    const second = new AbortController()
    engine.setPreparing('c1', first)
    // A stale controller must not clear the current preparing slot.
    engine.clearPreparing('c1', second)
    expect(engine.isRunning('c1')).toBe(true)
    engine.clearPreparing('c1', first)
    expect(engine.isRunning('c1')).toBe(false)
  })

  it('listRunning unions preparing and inflight chats without duplicates', () => {
    const engine = createRunEngine()
    engine.setPreparing('c1', new AbortController())
    engine.beginRun('c1') // same chat both preparing and inflight
    engine.beginRun('c2')
    expect(engine.listRunning().sort()).toEqual(['c1', 'c2'])
  })
})
