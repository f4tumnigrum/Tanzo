import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import { findCut, splitForCompaction, splitModelTranscript } from '@main/agent/context/compact/cut'
import { degradeTranscript } from '@main/agent/context/compact/degrade'
import { splitAssistantSteps } from '@shared/message-steps'

function user(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

function summary(id: string): TanzoUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'summary' },
      { type: 'data-compaction', data: { stage: 'complete', summaryId: id, summary: 'summary' } }
    ]
  } as TanzoUIMessage
}

function assistantLoop(id: string, steps: string[]): TanzoUIMessage {
  const parts = steps.flatMap((text) => [
    { type: 'step-start' as const },
    { type: 'text' as const, text }
  ])
  return { id, role: 'assistant', parts } as TanzoUIMessage
}

describe('compact/cut — UI domain (persisted transcript)', () => {
  it('returns null when the transcript fits the retain budget', () => {
    expect(findCut([user('u1', 'small')], 1_000)).toBeNull()
  })

  it('cuts at a round boundary preferentially', () => {
    const messages = [
      user('u1', 'a'.repeat(400)),
      assistantLoop('a1', ['b'.repeat(400)]),
      user('u2', 'c'.repeat(40)),
      assistantLoop('a2', ['d'.repeat(40)])
    ]
    // budget 100 tokens: the last round (u2+a2 ≈ 20 tokens) fits; cut before u2.
    expect(findCut(messages, 100)).toBe(2)
  })

  it('degrades to a step-group row boundary inside a giant single round', () => {
    // v1 defect D1: a 50-step autonomous round could never be cut. Persisted
    // transcripts are per-step rows (design §4.5), so the cut lands between
    // step fragments of the same reply.
    const steps = Array.from({ length: 50 }, () => 'x'.repeat(400))
    const rows = [user('u1', 'go'), ...splitAssistantSteps(assistantLoop('a1', steps))]
    const cut = findCut(rows, 500)
    expect(cut).not.toBeNull()
    expect(cut!).toBeGreaterThan(1)
    expect(cut!).toBeLessThan(rows.length)
    // The cut lands on a step fragment of a1, not on a whole-message boundary.
    expect(rows[cut!].id).toMatch(/^a1::step-/)
  })

  it('never cuts before the latest summary but may archive it (rolling)', () => {
    const messages = [
      user('u1', 'old'.repeat(400)),
      summary('s1'),
      user('u2', 'y'.repeat(4_000)),
      user('u3', 'z'.repeat(40))
    ]
    const partition = splitForCompaction(messages, 100)
    expect(partition).not.toBeNull()
    // Head includes the old summary (rolled up), tail keeps the recent round.
    expect(partition!.archivedIds).toContain('s1')
    expect(partition!.archivedIds).toContain('u2')
    expect(partition!.tail.map((m) => m.id)).toEqual(['u3'])
  })

  it('returns null when only a summary would move', () => {
    expect(splitForCompaction([summary('s1'), user('u2', 'tiny')], 100_000)).toBeNull()
  })

  it('findCut itself rejects a summary-only head (contract, not just planCompaction)', () => {
    // Over budget, but the only unit before the cut would be the summary.
    const messages = [summary('s1'), user('u2', 'z'.repeat(4_000))]
    expect(findCut(messages, 100)).toBeNull()
  })

  it('splits on whole rows only — head ids and tail rows stay intact', () => {
    const rows = [
      user('u1', 'go'),
      ...splitAssistantSteps(assistantLoop('a1', ['early'.repeat(100), 'late']))
    ]
    const partition = splitForCompaction(rows, 4)
    expect(partition).not.toBeNull()
    const { head, tail, archivedIds } = partition!
    // No synthetic ids: every id in head/tail existed in the input.
    const inputIds = new Set(rows.map((row) => row.id))
    for (const row of [...head, ...tail]) expect(inputIds.has(row.id)).toBe(true)
    expect(archivedIds).toEqual(head.map((row) => row.id))
    expect(head.length + tail.length).toBe(rows.length)
  })
})

describe('compact/cut — model domain (live transcript)', () => {
  function toolStep(i: number, payload: string): ModelMessage[] {
    return [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: `c${i}`, toolName: 'shell', input: {} }]
      } as ModelMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: `c${i}`,
            toolName: 'shell',
            output: { type: 'text', value: payload }
          }
        ]
      } as ModelMessage
    ]
  }

  it('returns null when the transcript fits', () => {
    expect(splitModelTranscript([{ role: 'user', content: 'hi' }], 1_000)).toBeNull()
  })

  it('cuts a long tool loop at a step-group boundary, never orphaning a pair', () => {
    const transcript: ModelMessage[] = [{ role: 'user', content: 'go' }]
    for (let i = 0; i < 30; i += 1) transcript.push(...toolStep(i, 'y'.repeat(4_000)))

    const split = splitModelTranscript(transcript, 5_000)
    expect(split).not.toBeNull()
    expect(split!.head.length + split!.tail.length).toBe(transcript.length)
    // The tail never starts with an orphan tool message.
    expect(split!.tail[0].role).not.toBe('tool')
    // Every tool-call in the head has its result in the head (closed groups).
    const headCalls = new Set<string>()
    const headResults = new Set<string>()
    for (const message of split!.head) {
      if (!Array.isArray(message.content)) continue
      for (const part of message.content) {
        const record = part as { type?: string; toolCallId?: string }
        if (record.type === 'tool-call') headCalls.add(record.toolCallId!)
        if (record.type === 'tool-result') headResults.add(record.toolCallId!)
      }
    }
    expect([...headCalls].every((id) => headResults.has(id))).toBe(true)
  })

  it('prefers round boundaries when multiple rounds exist', () => {
    const transcript: ModelMessage[] = [
      { role: 'user', content: 'first'.repeat(2_000) },
      { role: 'assistant', content: 'answer one' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer two' }
    ]
    const split = splitModelTranscript(transcript, 100)
    expect(split).not.toBeNull()
    expect(split!.tail[0]).toMatchObject({ role: 'user', content: 'second' })
  })
})

describe('compact/degrade — mechanical L3/L4', () => {
  it('returns null when the transcript is under the hard ceiling', () => {
    expect(degradeTranscript([{ role: 'user', content: 'small' }], 1_000)).toBeNull()
  })

  it('L3 prunes old tool payloads while keeping the recent window', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'go' }]
    for (let i = 0; i < 20; i += 1) {
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: `c${i}`, toolName: 'shell', input: {} }]
      } as ModelMessage)
      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: `c${i}`,
            toolName: 'shell',
            output: { type: 'text', value: 'z'.repeat(8_000) }
          }
        ]
      } as ModelMessage)
    }
    const out = degradeTranscript(messages, 15_000)
    expect(out).not.toBeNull()
    expect(['prune', 'drop-oldest']).toContain(out!.level)
  })

  it('L4 drops oldest rounds but keeps a leading summary and always converges', () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: 'summary of earlier work' },
      { role: 'user', content: 'q'.repeat(200_000) },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'recent question' }
    ]
    const out = degradeTranscript(messages, 5_000)
    expect(out).not.toBeNull()
    expect(out!.level).toBe('drop-oldest')
    expect(out!.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'summary of earlier work'
    })
    expect(out!.messages.at(-1)).toMatchObject({ content: 'recent question' })
  })

  it('never drops the final message even under an impossible ceiling', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'a'.repeat(100_000) },
      { role: 'user', content: 'b'.repeat(100_000) }
    ]
    const out = degradeTranscript(messages, 1)
    expect(out).not.toBeNull()
    expect(out!.messages.length).toBeGreaterThanOrEqual(1)
  })

  it('never returns a transcript opening with a tool message', () => {
    // Pruning can empty and remove a leading assistant while its tool block
    // survives; the degraded transcript must not open with role:'tool'.
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c0',
            toolName: 'shell',
            output: { type: 'text', value: 'x'.repeat(100_000) }
          }
        ]
      } as ModelMessage,
      { role: 'user', content: 'recent'.repeat(10_000) },
      { role: 'assistant', content: 'answer' }
    ]
    const out = degradeTranscript(messages, 5_000)
    expect(out).not.toBeNull()
    expect(out!.messages[0].role).not.toBe('tool')
  })
})
