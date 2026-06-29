import { describe, expect, it } from 'vitest'
import { createPluginMentionTracker } from '@main/agent/plugins/mention-tracker'

describe('agent/plugins/mention-tracker', () => {
  it('records only @mentions matching a known plugin name', () => {
    const tracker = createPluginMentionTracker(() => ['sales', 'data-analytics'])
    tracker.recordFromText('c1', 'hey @sales forecast Q3 and ignore @marketing')
    expect(tracker.peek('c1')).toEqual(['sales'])
  })

  it('records multiple distinct mentions, de-duplicated and order-preserved', () => {
    const tracker = createPluginMentionTracker(() => ['sales', 'data-analytics'])
    tracker.recordFromText('c1', '@data-analytics then @sales then @data-analytics again')
    expect(tracker.peek('c1')).toEqual(['data-analytics', 'sales'])
  })

  it('ignores @mentions when no plugins are active', () => {
    const tracker = createPluginMentionTracker(() => [])
    tracker.recordFromText('c1', '@sales hi')
    expect(tracker.peek('c1')).toEqual([])
  })

  it('does not match an @ embedded in a word (e.g. an email)', () => {
    const tracker = createPluginMentionTracker(() => ['sales'])
    tracker.recordFromText('c1', 'mail me at bob@sales.com')
    expect(tracker.peek('c1')).toEqual([])
  })

  it('matches a mention at the very start of the message', () => {
    const tracker = createPluginMentionTracker(() => ['sales'])
    tracker.recordFromText('c1', '@sales help')
    expect(tracker.peek('c1')).toEqual(['sales'])
  })

  it('a later message without mentions clears a stale pending set', () => {
    const tracker = createPluginMentionTracker(() => ['sales'])
    tracker.recordFromText('c1', '@sales help')
    expect(tracker.peek('c1')).toEqual(['sales'])
    tracker.recordFromText('c1', 'thanks, no mention here')
    expect(tracker.peek('c1')).toEqual([])
  })

  it('take clears the pending mentions', () => {
    const tracker = createPluginMentionTracker(() => ['sales'])
    tracker.recordFromText('c1', '@sales help')
    tracker.take('c1')
    expect(tracker.peek('c1')).toEqual([])
  })

  it('keeps mentions isolated per chat', () => {
    const tracker = createPluginMentionTracker(() => ['sales'])
    tracker.recordFromText('c1', '@sales help')
    expect(tracker.peek('c2')).toEqual([])
    expect(tracker.peek('c1')).toEqual(['sales'])
  })
})
