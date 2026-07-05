import { describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import { stabilizeMessage } from '@renderer/features/chat/model/conversation/stabilize'
import { createTranscriptStore } from '@renderer/features/chat/model/conversation/transcript-store'

function textMessage(id: string, text: string): TanzoUIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text, state: 'done' }] } as TanzoUIMessage
}

describe('chat/conversation/stabilize', () => {
  it('returns the previous object when nothing changed', () => {
    const prev = textMessage('m1', 'hello')
    const next = structuredClone(prev)
    expect(stabilizeMessage(prev, next)).toBe(prev)
  })

  it('reuses unchanged part identities when only the tail part grows', () => {
    const finishedTool = {
      type: 'tool-shell',
      toolCallId: 'c1',
      state: 'output-available',
      input: { command: 'ls' },
      output: { stdout: 'ok', stderr: '', code: 0 }
    }
    const prev = {
      id: 'a1',
      role: 'assistant',
      parts: [finishedTool, { type: 'text', text: 'Par', state: 'streaming' }]
    } as TanzoUIMessage
    const next = {
      id: 'a1',
      role: 'assistant',
      parts: [structuredClone(finishedTool), { type: 'text', text: 'Partial', state: 'streaming' }]
    } as TanzoUIMessage

    const stabilized = stabilizeMessage(prev, next)
    expect(stabilized).not.toBe(prev)
    expect(stabilized.parts[0]).toBe(prev.parts[0])
    expect(stabilized.parts[1]).toBe(next.parts[1])
  })

  it('returns next unchanged for a different message id', () => {
    const prev = textMessage('m1', 'a')
    const next = textMessage('m2', 'a')
    expect(stabilizeMessage(prev, next)).toBe(next)
  })

  it('detects metadata changes', () => {
    const prev = textMessage('m1', 'a')
    const next = { ...structuredClone(prev), metadata: { usage: { totalTokens: 5 } } }
    const stabilized = stabilizeMessage(prev, next as TanzoUIMessage)
    expect(stabilized).not.toBe(prev)
    expect(stabilized.metadata).toEqual({ usage: { totalTokens: 5 } })
  })
})

describe('chat/conversation/transcript-store', () => {
  it('keeps order identity stable across content-only updates', () => {
    const store = createTranscriptStore([textMessage('m1', 'one')])
    const initialOrder = store.getOrder()

    store.upsert(textMessage('m1', 'one updated'))
    store.flushSync()

    expect(store.getOrder()).toBe(initialOrder)
    expect(store.getMessage('m1')?.parts[0]).toMatchObject({ text: 'one updated' })
  })

  it('notifies only the changed message subscription', () => {
    const store = createTranscriptStore([textMessage('m1', 'one'), textMessage('m2', 'two')])
    let m1Notified = 0
    let m2Notified = 0
    let orderNotified = 0
    store.subscribeMessage('m1', () => (m1Notified += 1))
    store.subscribeMessage('m2', () => (m2Notified += 1))
    store.subscribeOrder(() => (orderNotified += 1))

    store.upsert(textMessage('m2', 'two updated'))
    store.flushSync()

    expect(m1Notified).toBe(0)
    expect(m2Notified).toBe(1)
    expect(orderNotified).toBe(0)
  })

  it('coalesces multiple upserts of one message into a single notification', () => {
    const store = createTranscriptStore([textMessage('m1', 'a')])
    let notified = 0
    store.subscribeMessage('m1', () => (notified += 1))

    store.upsert(textMessage('m1', 'ab'))
    store.upsert(textMessage('m1', 'abc'))
    store.upsert(textMessage('m1', 'abcd'))
    store.flushSync()

    expect(notified).toBe(1)
    expect(store.getMessage('m1')?.parts[0]).toMatchObject({ text: 'abcd' })
  })

  it('appends new messages to the order and notifies order subscribers', () => {
    const store = createTranscriptStore([textMessage('m1', 'one')])
    let orderNotified = 0
    store.subscribeOrder(() => (orderNotified += 1))

    store.upsert(textMessage('m2', 'two'))
    store.flushSync()

    expect(orderNotified).toBe(1)
    expect(store.getOrder()).toEqual(['m1', 'm2'])
  })

  it('replaceAll wins over earlier queued upserts and reconciles removals', () => {
    const store = createTranscriptStore([textMessage('m1', 'one'), textMessage('m2', 'two')])

    store.upsert(textMessage('m3', 'three'))
    store.replaceAll([textMessage('m2', 'two v2')])
    store.flushSync()

    expect(store.getOrder()).toEqual(['m2'])
    expect(store.getMessage('m1')).toBeUndefined()
    expect(store.getMessage('m3')).toBeUndefined()
    expect(store.getMessage('m2')?.parts[0]).toMatchObject({ text: 'two v2' })
  })

  it('folds upserts arriving after a queued replaceAll into the replacement', () => {
    const store = createTranscriptStore([])

    store.replaceAll([textMessage('m1', 'one')])
    store.upsert(textMessage('m2', 'two'))
    store.flushSync()

    expect(store.getOrder()).toEqual(['m1', 'm2'])
  })

  it('preserves message identity through a no-op replaceAll (settle refresh)', () => {
    const original = textMessage('m1', 'stable')
    const store = createTranscriptStore([original])
    let notified = 0
    store.subscribeMessage('m1', () => (notified += 1))

    store.replaceAll([structuredClone(original)])
    store.flushSync()

    expect(notified).toBe(0)
    expect(store.getMessage('m1')).toBe(original)
  })

  it('emits a change feed with the changed ids per commit', () => {
    const store = createTranscriptStore([textMessage('m1', 'one')])
    const feed: Array<{ ids: string[]; orderChanged: boolean }> = []
    store.subscribeChanges((ids, orderChanged) => feed.push({ ids: [...ids], orderChanged }))

    store.upsert(textMessage('m1', 'one v2'))
    store.upsert(textMessage('m2', 'two'))
    store.flushSync()

    expect(feed).toEqual([{ ids: ['m1', 'm2'], orderChanged: true }])
  })
})
