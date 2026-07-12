import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { canonicalizeToolTranscript } from '@main/agent/context/tool-transcript'

function assistantToolCall(callId: string): ModelMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'calling tool' },
      { type: 'tool-call', toolCallId: callId, toolName: 'shell', input: {} }
    ]
  } as ModelMessage
}

function toolResult(callId: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: callId,
        toolName: 'shell',
        output: { type: 'text', value: 'ok' }
      }
    ]
  } as ModelMessage
}

function approvalRequest(callId: string, approvalId: string): ModelMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: callId, toolName: 'shell', input: {} },
      { type: 'tool-approval-request', approvalId, toolCallId: callId }
    ]
  } as ModelMessage
}

function approvalResponse(approvalId: string): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool-approval-response', approvalId, approved: true }]
  } as ModelMessage
}

function callIdsOf(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if ((part as { type?: string }).type === 'tool-call') {
        ids.add((part as { toolCallId: string }).toolCallId)
      }
    }
  }
  return ids
}

function resultIdsOf(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if ((part as { type?: string }).type === 'tool-result') {
        ids.add((part as { toolCallId: string }).toolCallId)
      }
    }
  }
  return ids
}

function toolPartsOf(messages: ModelMessage[]): unknown[] {
  return messages.flatMap((message) =>
    message.role === 'tool' && Array.isArray(message.content) ? message.content : []
  )
}

describe('main/agent/context/tool-transcript', () => {
  it('keeps a paired tool-call and tool-result', () => {
    const out = canonicalizeToolTranscript([
      assistantToolCall('c1'),
      toolResult('c1'),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] } as ModelMessage
    ])
    expect(callIdsOf(out)).toEqual(resultIdsOf(out))
  })

  it('drops a tool-call that has no tool-result', () => {
    const out = canonicalizeToolTranscript([
      assistantToolCall('c1'),
      { role: 'assistant', content: [{ type: 'text', text: 'continued' }] } as ModelMessage
    ])
    expect(callIdsOf(out).has('c1')).toBe(false)
  })

  it('drops a tool-call when its tool-result is not in the following tool block', () => {
    const out = canonicalizeToolTranscript([
      assistantToolCall('c1'),
      { role: 'user', content: 'interruption' },
      toolResult('c1')
    ])

    expect(callIdsOf(out).has('c1')).toBe(false)
    expect(resultIdsOf(out).has('c1')).toBe(false)
  })

  it('keeps provider-executed tool parts that are returned in the assistant message', () => {
    const message = {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'provider-call',
          toolName: 'web_search',
          input: { query: 'Tanzo' },
          providerExecuted: true
        },
        {
          type: 'tool-result',
          toolCallId: 'provider-call',
          toolName: 'web_search',
          output: { type: 'text', value: 'result' }
        }
      ]
    } as ModelMessage

    const out = canonicalizeToolTranscript([
      message,
      { role: 'user', content: 'continue' } as ModelMessage
    ])

    expect(out[0]).toEqual(message)
  })

  it('keeps a provider-executed call without a host tool-result', () => {
    const out = canonicalizeToolTranscript([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'provider-call',
            toolName: 'web_search',
            input: { query: 'Tanzo' },
            providerExecuted: true
          }
        ]
      } as ModelMessage,
      { role: 'user', content: 'continue' } as ModelMessage
    ])

    expect(callIdsOf(out)).toEqual(new Set(['provider-call']))
  })

  it('pairs and orders results across consecutive tool messages as one block', () => {
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {} },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'shell', input: {} }
      ]
    } as ModelMessage
    const out = canonicalizeToolTranscript([
      assistant,
      toolResult('c2'),
      toolResult('c1'),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] } as ModelMessage
    ])

    expect(callIdsOf(out)).toEqual(new Set(['c1', 'c2']))
    expect(resultIdsOf(out)).toEqual(new Set(['c1', 'c2']))
    expect(
      out.flatMap((message) =>
        message.role === 'tool' && Array.isArray(message.content)
          ? message.content
              .filter((part) => (part as { type?: string }).type === 'tool-result')
              .map((part) => (part as { toolCallId: string }).toolCallId)
          : []
      )
    ).toEqual(['c1', 'c2'])
  })

  it('keeps a final approved unresolved tool-call so the SDK can resume it', () => {
    const out = canonicalizeToolTranscript([approvalRequest('c1', 'a1'), approvalResponse('a1')])

    expect(callIdsOf(out)).toEqual(new Set(['c1']))
    expect(resultIdsOf(out)).toEqual(new Set())
    expect(
      out.some(
        (message) =>
          message.role === 'tool' &&
          Array.isArray(message.content) &&
          message.content.some(
            (part) =>
              (part as { type?: string; approvalId?: string }).type === 'tool-approval-response' &&
              (part as { approvalId?: string }).approvalId === 'a1'
          )
      )
    ).toBe(true)
  })

  it('drops an approved unresolved tool-call after the conversation has continued', () => {
    const out = canonicalizeToolTranscript([
      approvalRequest('c1', 'a1'),
      approvalResponse('a1'),
      { role: 'assistant', content: [{ type: 'text', text: 'next' }] } as ModelMessage
    ])

    expect(callIdsOf(out).has('c1')).toBe(false)
    expect(
      toolPartsOf(out).some((part) => (part as { type?: string }).type === 'tool-approval-response')
    ).toBe(false)
  })

  it('orders tool-results before approval responses inside a tool message', () => {
    const out = canonicalizeToolTranscript([
      approvalRequest('c1', 'a1'),
      {
        role: 'tool',
        content: [
          { type: 'tool-approval-response', approvalId: 'a1', approved: true },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'shell',
            output: { type: 'text', value: 'ok' }
          }
        ]
      } as ModelMessage
    ])

    expect((toolPartsOf(out)[0] as { type?: string }).type).toBe('tool-result')
  })

  it('does not backfill an approved missing call when another call already has a result', () => {
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {} },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'shell', input: {} },
        { type: 'tool-approval-request', approvalId: 'a2', toolCallId: 'c2' }
      ]
    } as ModelMessage
    const out = canonicalizeToolTranscript([assistant, toolResult('c1'), approvalResponse('a2')])
    expect(callIdsOf(out)).toEqual(new Set(['c1', 'c2']))
    expect(resultIdsOf(out)).toEqual(new Set(['c1']))
  })
})
