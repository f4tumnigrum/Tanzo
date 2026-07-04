import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  buildCompactionResult,
  planCompaction,
  splitForCompaction
} from '@main/agent/context/compact/compact'
import { extractPartialSummary, stripAnalysis } from '@main/agent/context/compact/prompt'

const aiMocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(async (messages: unknown) => messages)
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    convertToModelMessages: aiMocks.convertToModelMessages
  }
})

function userMessage(id: string, text: string, summary = false): TanzoUIMessage {
  return {
    id,
    role: summary ? 'assistant' : 'user',
    parts: summary
      ? [
          { type: 'text', text },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: id, summary: text } }
        ]
      : [{ type: 'text', text }]
  } as TanzoUIMessage
}

describe('main/agent/context/compact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('splits old messages from the recent step window at message boundaries', () => {
    const messages = [
      userMessage('m1', 'a'.repeat(80)),
      userMessage('m2', 'b'.repeat(80)),
      userMessage('m3', 'c'.repeat(8))
    ]

    expect(splitForCompaction(messages, 1)).toEqual({
      head: [messages[0], messages[1]],
      tail: [messages[2]],
      archivedIds: ['m1', 'm2']
    })
  })

  it('always retains the final unit even when the budget is zero', () => {
    const messages = [
      userMessage('m1', 'a'.repeat(80)),
      userMessage('m2', 'b'.repeat(80)),
      userMessage('m3', 'c'.repeat(8))
    ]

    expect(splitForCompaction(messages, 0)).toEqual({
      head: [messages[0], messages[1]],
      tail: [messages[2]],
      archivedIds: ['m1', 'm2']
    })
  })

  it('returns null when everything after the latest summary fits the budget', () => {
    const messages = [
      userMessage('m1', 'old'.repeat(200)),
      userMessage('s1', 'summary', true),
      userMessage('m2', 'recent')
    ]

    expect(splitForCompaction(messages, 100)).toBeNull()
  })

  it('rolls an existing summary into the head, never cutting before it', () => {
    const messages = [
      userMessage('m1', 'old'.repeat(200)),
      userMessage('s1', 'summary', true),
      userMessage('m2', 'x'.repeat(400))
    ]

    expect(splitForCompaction(messages, 1)).toEqual({
      head: [messages[0], messages[1]],
      tail: [messages[2]],
      archivedIds: ['m1', 's1']
    })
  })

  it('cuts between per-step assistant rows inside a single round', () => {
    // Per-step persistence (design §4.5): a multi-step reply is stored as one
    // row per step group, so the cut always lands on a whole-row boundary.
    const stepA = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'step-start' }, { type: 'text', text: 'x'.repeat(400) }]
    } as TanzoUIMessage
    const stepB = {
      id: 'a1::step-1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'y'.repeat(8) }
      ]
    } as TanzoUIMessage
    const { head, tail, archivedIds } = splitForCompaction(
      [userMessage('u1', 'go'), stepA, stepB],
      1
    )!

    expect(archivedIds).toEqual(['u1', 'a1'])
    expect(head).toEqual([userMessage('u1', 'go'), stepA])
    expect(tail).toEqual([stepB])
  })

  it('passes plain-text summaries through unchanged', () => {
    expect(stripAnalysis('Just a plain summary.\nWith two lines.')).toBe(
      'Just a plain summary.\nWith two lines.'
    )
  })

  it('extracts summary blocks and removes private analysis fallback blocks', () => {
    expect(stripAnalysis('<analysis>hidden</analysis><summary>keep me</summary>')).toBe('keep me')
    expect(stripAnalysis('<analysis>hidden</analysis>fallback')).toBe('fallback')
  })

  it('never persists analysis content when the summary tag is unterminated', () => {
    // Regression: a stream cut off before </summary> used to fall back to the
    // raw text (analysis included) becoming the durable summary.
    expect(stripAnalysis('<analysis>secret reasoning</analysis><summary>good part')).toBe(
      'good part'
    )
    // Unterminated analysis with no summary yields nothing rather than leaking
    // the reasoning; buildCompactionResult then aborts on the empty summary.
    expect(stripAnalysis('<analysis>secret reasoning only')).toBe('')
  })

  it('extracts only the visible partial summary without leaking analysis', () => {
    expect(extractPartialSummary('<analysis>hidden</analysis><summary>keep me')).toBe('keep me')
    expect(extractPartialSummary('<analysis>hidden</analysis>')).toBe('')
    expect(extractPartialSummary('<summary>\nnext line')).toBe('next line')
  })

  it('plans a compaction with split head/tail and canonicalized source messages', async () => {
    const plan = await planCompaction([userMessage('m1', 'old'), userMessage('m2', 'recent')], 1)

    expect(plan).not.toBeNull()
    expect(plan?.archivedIds).toEqual(['m1'])
    expect(plan?.head).toEqual([userMessage('m1', 'old')])
    expect(plan?.tail).toEqual([userMessage('m2', 'recent')])
    expect(plan?.sourceMessages).toEqual([userMessage('m1', 'old')])
    expect(plan).not.toHaveProperty('beforeTokens')
  })

  it('returns null when there is nothing to summarize', async () => {
    const plan = await planCompaction([userMessage('m1', 'only recent')], 100000)
    expect(plan).toBeNull()
  })

  it('does not plan compaction for a head that is only an existing summary', async () => {
    const plan = await planCompaction(
      [userMessage('s1', 'summary', true), userMessage('m1', 'huge recent')],
      1
    )
    expect(plan).toBeNull()
  })

  it('builds an assistant-role summary carrying a compaction data part', async () => {
    const plan = await planCompaction([userMessage('m1', 'old'), userMessage('m2', 'recent')], 1)
    const result = buildCompactionResult({
      plan: plan!,
      summaryText: '<summary>condensed</summary>',
      summaryId: 'summary-fixed',
      auto: false,
      usage: { inputTokens: 100, outputTokens: 12, totalTokens: 112 }
    })

    expect(result.summary.id).toBe('summary-fixed')
    expect(result.summary.role).toBe('assistant')
    expect(result.summary.parts[0]).toEqual({ type: 'text', text: 'condensed' })
    expect(result.summary.parts[1]).toMatchObject({
      type: 'data-compaction',
      data: {
        stage: 'complete',
        summary: 'condensed',
        summaryId: 'summary-fixed',
        beforeTokens: 100,
        afterTokens: 12,
        reducedTokens: 88,
        usage: { inputTokens: 100, outputTokens: 12, totalTokens: 112 }
      }
    })
    expect(result.summary.metadata).toBeUndefined()
    expect(result.archivedIds).toEqual(['m1'])
    expect(result.next[0]).toBe(result.summary)
    expect(result.next[1]).toEqual(userMessage('m2', 'recent'))
  })

  it('omits token reduction stats when compaction usage is unavailable', async () => {
    const plan = await planCompaction([userMessage('m1', 'old'), userMessage('m2', 'recent')], 1)
    const result = buildCompactionResult({
      plan: plan!,
      summaryText: '<summary>condensed</summary>',
      auto: false
    })

    expect(result.beforeTokens).toBeUndefined()
    expect(result.afterTokens).toBeUndefined()
    expect(result.summary.parts[1]).toMatchObject({
      type: 'data-compaction',
      data: expect.not.objectContaining({
        beforeTokens: expect.any(Number),
        afterTokens: expect.any(Number),
        reducedTokens: expect.any(Number)
      })
    })
    const compactionPart = result.summary.parts[1]
    expect(compactionPart).toMatchObject({
      type: 'data-compaction',
      data: expect.objectContaining({ omittedMessages: 1 })
    })
    if (compactionPart.type !== 'data-compaction') throw new Error('expected compaction part')
    expect(
      Object.prototype.hasOwnProperty.call(
        compactionPart.data,
        ['tailBoundary', 'MessageId'].join('')
      )
    ).toBe(false)
  })

  it('throws when the summary text is empty after stripping analysis', async () => {
    const plan = await planCompaction([userMessage('m1', 'old'), userMessage('m2', 'recent')], 1)

    expect(() =>
      buildCompactionResult({
        plan: plan!,
        summaryText: '<analysis>hidden</analysis>',
        auto: false
      })
    ).toThrow('Compaction produced an empty summary')
  })
})
