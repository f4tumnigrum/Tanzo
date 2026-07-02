import { describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import { findCut, flattenSegments, partitionAtCut } from '@main/agent/context/compact/segments'

function user(id: string, text: string, summary = false): TanzoUIMessage {
  return {
    id,
    role: summary ? 'system' : 'user',
    parts: summary
      ? [
          { type: 'text', text },
          { type: 'data-compaction', data: { stage: 'complete', summaryId: id, summary: text } }
        ]
      : [{ type: 'text', text }]
  } as TanzoUIMessage
}

function assistantLoop(id: string, steps: string[]): TanzoUIMessage {
  const parts = steps.flatMap((text) => [
    { type: 'step-start' as const },
    { type: 'text' as const, text }
  ])
  return { id, role: 'assistant', parts } as TanzoUIMessage
}

describe('main/agent/context/compact/segments', () => {
  it('flattens an assistant tool loop into one segment per step', () => {
    const messages = [user('u1', 'go'), assistantLoop('a1', ['s1', 's2', 's3'])]
    const segments = flattenSegments(messages)
    expect(segments).toHaveLength(4)
    expect(segments.slice(1).map((s) => ({ m: s.messageIndex, start: s.partStart }))).toEqual([
      { m: 1, start: 0 },
      { m: 1, start: 2 },
      { m: 1, start: 4 }
    ])
  })

  it('treats each non-assistant message as a single segment', () => {
    const segments = flattenSegments([user('u1', 'a'), user('u2', 'b')])
    expect(segments.map((s) => s.messageIndex)).toEqual([0, 1])
    expect(segments.every((s) => s.partStart === 0)).toBe(true)
  })

  it('finds a message-boundary cut when the recent window aligns to messages', () => {
    const messages = [user('m1', 'x'.repeat(80)), user('m2', 'y'.repeat(8))]
    expect(findCut(messages, 1)).toEqual({ messageIndex: 1, partIndex: 0 })
  })

  it('finds an in-message cut at a step-start when the loop is large', () => {
    const messages = [user('u1', 'go'), assistantLoop('a1', ['x'.repeat(400), 'y'.repeat(8)])]
    expect(findCut(messages, 1)).toEqual({ messageIndex: 1, partIndex: 2 })
  })

  it('never cuts before the last existing summary', () => {
    const messages = [user('m1', 'old'), user('s1', 'sum', true), user('m2', 'z'.repeat(400))]

    expect(findCut(messages, 1)).toEqual({ messageIndex: 2, partIndex: 0 })
  })

  it('partitions a message-boundary cut as plain slices', () => {
    const messages = [user('m1', 'a'), user('m2', 'b')]
    expect(partitionAtCut(messages, { messageIndex: 1, partIndex: 0 })).toEqual({
      head: [messages[0]],
      tail: [messages[1]],
      archivedIds: ['m1']
    })
  })

  it('falls back to message boundary when the head portion has a tool-invocation', () => {
    // Step 1 has a tool-invocation; step 2 is plain text.
    // Without the guard, findCut would return { messageIndex:1, partIndex:2 }
    // and leave the tool-invocation call in the head with its result in the tail.
    const loopWithTool = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-fileRead',
          toolInvocation: { toolCallId: 'tc1', toolName: 'fileRead', state: 'call', input: {} }
        },
        { type: 'step-start' },
        { type: 'text', text: 'done' }
      ]
    } as TanzoUIMessage
    const cut = findCut([user('u1', 'go'), loopWithTool], 1)
    // The guard must push the cut to a whole-message boundary (partIndex: 0).
    expect(cut).toEqual({ messageIndex: 1, partIndex: 0 })
  })

  it('keeps an in-message cut when head portion has no tool-invocation', () => {
    // Both steps are plain text — safe to split mid-message.
    const messages = [user('u1', 'go'), assistantLoop('a1', ['step1', 'step2'])]
    const cut = findCut(messages, 1)
    // Normal in-message cut: step 2 starts at partIndex 2.
    expect(cut).toEqual({ messageIndex: 1, partIndex: 2 })
  })

  it('partitions an in-message cut into head + fresh tail fragment', () => {
    const loop = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'early' },
        { type: 'step-start' },
        { type: 'reasoning', text: 'private' },
        { type: 'text', text: 'late' }
      ]
    } as TanzoUIMessage
    const { head, tail, archivedIds } = partitionAtCut([user('u1', 'go'), loop], {
      messageIndex: 1,
      partIndex: 2
    })
    expect(archivedIds).toEqual(['u1', 'a1'])
    expect(head[1].parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'early' }])
    expect(tail[0].id).not.toBe('a1')

    expect(tail[0].parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'late' }])
  })
})
