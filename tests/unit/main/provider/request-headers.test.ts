import { describe, expect, it } from 'vitest'
import { conversationRequestHeaders } from '@main/provider/request-headers'

describe('main/provider/request-headers', () => {
  it('sets x-grok-conv-id for grok keyed on the conversation id', () => {
    expect(conversationRequestHeaders('grok', 'chat-123')).toEqual({
      'x-grok-conv-id': 'chat-123'
    })
  })

  it('trims the conversation id and drops empty ids', () => {
    expect(conversationRequestHeaders('grok', '  chat-123  ')).toEqual({
      'x-grok-conv-id': 'chat-123'
    })
    expect(conversationRequestHeaders('grok', '   ')).toBeUndefined()
  })

  it('returns undefined for providers without conversation headers', () => {
    expect(conversationRequestHeaders('openai', 'chat-123')).toBeUndefined()
    expect(conversationRequestHeaders('anthropic', 'chat-123')).toBeUndefined()
    expect(conversationRequestHeaders('openai-compatible', 'chat-123')).toBeUndefined()
  })
})
