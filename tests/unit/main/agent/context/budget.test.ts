import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { createBudget } from '@main/agent/context/budget'

function textMessages(texts: string[]): ModelMessage[] {
  return texts.map((t) => ({ role: 'user', content: t }) as ModelMessage)
}

describe('main/agent/context/budget', () => {
  it('returns unavailable when no anchor and messages are empty', () => {
    const b = createBudget()
    const usage = b.measureUsage('chat-1', [])
    expect(usage.source).toBe('estimated')
    expect(usage.exceeds(1000)).toBe(false)
  })

  it('uses char/4 estimate when no anchor exists (e.g. post-compaction)', () => {
    const b = createBudget()
    // 4000 chars → ~1000 tokens estimate
    const messages = textMessages(['x'.repeat(4000)])
    const usage = b.measureUsage('chat-1', messages)
    expect(usage.source).toBe('estimated')
    expect(usage.inputTokens).toBe(1000)
    expect(usage.exceeds(999)).toBe(true)
    expect(usage.exceeds(1000)).toBe(false)
  })

  it('uses the reported anchor when messages are small', () => {
    const b = createBudget()
    b.anchor('chat-1', 5, 50_000)
    const small = textMessages(['hello'])
    const usage = b.measureUsage('chat-1', small)
    expect(usage.source).toBe('reported')
    expect(usage.inputTokens).toBe(50_000)
    expect(usage.exceeds(49_999)).toBe(true)
  })

  it('uses the char estimate when it exceeds a stale anchor (large paste between turns)', () => {
    const b = createBudget()
    b.anchor('chat-1', 5, 10_000)
    // Simulate a huge paste: 200k chars → ~50k token estimate, well above anchor
    const big = textMessages(['y'.repeat(200_000)])
    const usage = b.measureUsage('chat-1', big)
    expect(usage.inputTokens).toBeGreaterThan(10_000)
    // source switches to 'estimated' when estimate wins
    expect(usage.source).toBe('estimated')
  })

  it('falls back to estimate after anchor is cleared (post-compaction path)', () => {
    const b = createBudget()
    b.anchor('chat-1', 10, 80_000)
    b.clear('chat-1')
    const messages = textMessages(['z'.repeat(80_000)]) // ~20k tokens
    const usage = b.measureUsage('chat-1', messages)
    expect(usage.source).toBe('estimated')
    expect(usage.inputTokens).toBeGreaterThan(0)
  })

  it('anchor is not updated when inputTokens is zero', () => {
    const b = createBudget()
    b.anchor('chat-1', 3, 0) // should not record
    const usage = b.measureUsage('chat-1', [])
    expect(usage.source).toBe('estimated')
  })
})
