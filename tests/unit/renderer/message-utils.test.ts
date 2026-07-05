import { describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  latestCompaction,
  trailingUserMessageId
} from '@renderer/features/chat/model/conversation/message-utils'

function textMessage(id: string, text: string): TanzoUIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }]
  }
}

function summaryMessage(summaryId: string, summary: string): TanzoUIMessage {
  return {
    id: summaryId,
    role: 'user',
    parts: [
      { type: 'text', text: summary },
      { type: 'data-compaction', data: { stage: 'complete', summaryId, summary } }
    ]
  }
}

describe('chat/conversation/message-utils latestCompaction', () => {
  it('returns the most recent compaction data part', () => {
    const messages = [
      summaryMessage('summary-1', 'first'),
      textMessage('tail-1', 'tail'),
      summaryMessage('summary-2', 'second')
    ]

    expect(latestCompaction(messages)).toMatchObject({ summaryId: 'summary-2', summary: 'second' })
  })

  it('returns null when no compaction marker exists', () => {
    expect(latestCompaction([textMessage('m1', 'plain')])).toBeNull()
  })
})

describe('chat/conversation/message-utils trailingUserMessageId', () => {
  const injection = (id: string): TanzoUIMessage => ({
    id,
    role: 'user',
    parts: [{ type: 'data-contextInjection', data: { text: 'datetime: now' } } as never]
  })
  const assistant = (id: string): TanzoUIMessage => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: 'reply' }]
  })

  it('returns the id when the last message is a user prompt', () => {
    expect(trailingUserMessageId([assistant('a1'), textMessage('u1', 'hi')])).toBe('u1')
  })

  it('skips trailing synthetic context injections after a failed run', () => {
    expect(trailingUserMessageId([textMessage('u1', 'hi'), injection('inj-1')])).toBe('u1')
    expect(
      trailingUserMessageId([textMessage('u1', 'hi'), injection('inj-1'), injection('inj-2')])
    ).toBe('u1')
  })

  it('returns null when the last real message is an assistant reply', () => {
    expect(
      trailingUserMessageId([textMessage('u1', 'hi'), assistant('a1'), injection('inj-1')])
    ).toBeNull()
  })

  it('returns null for an empty transcript', () => {
    expect(trailingUserMessageId([])).toBeNull()
  })
})
