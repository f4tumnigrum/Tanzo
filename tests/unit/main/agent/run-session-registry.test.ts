import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import { createChatRunSessionRegistry } from '@main/agent/runtime/run-session-registry'

const baseMessages: TanzoUIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }]
  }
]

describe('agent/runtime/run-session-registry', () => {
  it('buffers active run frames and retains notifications for snapshots', () => {
    const streams = createChatRunSessionRegistry()
    expect(streams.start('chat-1', 'run-1', baseMessages)).toEqual({
      kind: 'run-state',
      chatId: 'chat-1',
      runId: 'run-1',
      runKind: 'chat',
      status: 'running'
    })

    streams.retainNotification('chat-1', {
      type: 'data-compaction',
      id: 'compaction:run-1',
      data: { stage: 'start' }
    } as never)
    const first = streams.publish(
      'chat-1',
      { type: 'start', messageId: 'assistant-1' },
      {
        runId: 'run-1'
      }
    )
    const stale = streams.publish(
      'chat-1',
      { type: 'text-delta', id: 't1', delta: 'late' },
      {
        runId: 'old-run'
      }
    )
    const second = streams.publish(
      'chat-1',
      { type: 'text-start', id: 't1' },
      {
        runId: 'run-1'
      }
    )

    expect(first).toMatchObject({
      status: 'accepted',
      frame: { kind: 'run-frame', runId: 'run-1', seq: 1 }
    })
    expect(stale).toEqual({ status: 'stale' })
    expect(second).toMatchObject({
      status: 'accepted',
      frame: { kind: 'run-frame', runId: 'run-1', seq: 2 }
    })
    expect(streams.snapshot('chat-1')).toMatchObject({
      chatId: 'chat-1',
      runId: 'run-1',
      status: 'running',
      baseMessages,
      notifications: [{ type: 'data-compaction', id: 'compaction:run-1' }],
      frames: [
        { seq: 1, chunk: { type: 'start', messageId: 'assistant-1' } },
        { seq: 2, chunk: { type: 'text-start', id: 't1' } }
      ]
    })
  })

  it('replaces retained notifications with the same id', () => {
    const streams = createChatRunSessionRegistry()
    streams.start('chat-1', 'run-1', baseMessages)

    streams.retainNotification('chat-1', {
      type: 'data-context',
      id: 'context:chat-1',
      data: { usedTokens: 10, source: 'reported', cacheKind: 'auto', serverCompaction: false }
    } as never)
    streams.retainNotification('chat-1', {
      type: 'data-context',
      id: 'context:chat-1',
      data: { usedTokens: 20, source: 'reported', cacheKind: 'auto', serverCompaction: false }
    } as never)

    expect(streams.snapshot('chat-1')?.notifications).toMatchObject([
      { type: 'data-context', id: 'context:chat-1', data: { usedTokens: 20 } }
    ])
  })

  it('only clears the matching active run', () => {
    const streams = createChatRunSessionRegistry()
    streams.start('chat-1', 'run-1', baseMessages)

    expect(streams.finish('chat-1', 'old-run', 'finished')).toBeNull()
    expect(streams.snapshot('chat-1')).not.toBeNull()

    expect(streams.finish('chat-1', 'run-1', 'failed')).toEqual({
      kind: 'run-state',
      chatId: 'chat-1',
      runId: 'run-1',
      runKind: 'chat',
      status: 'failed'
    })
    expect(streams.snapshot('chat-1')).toBeNull()
  })

  it('coalesces adjacent deltas and delivers one batch per flush', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({
      deliver: (event) => events.push(event),
      batchMs: 1000
    })
    streams.start('chat-1', 'run-1', baseMessages)

    streams.publish('chat-1', { type: 'text-start', id: 'text-1' }, { runId: 'run-1' })
    const firstDelta = streams.publish(
      'chat-1',
      { type: 'text-delta', id: 'text-1', delta: 'hel' },
      { runId: 'run-1' }
    )
    const secondDelta = streams.publish(
      'chat-1',
      { type: 'text-delta', id: 'text-1', delta: 'lo' },
      { runId: 'run-1' }
    )
    streams.flush('chat-1')

    expect(firstDelta).toMatchObject({
      status: 'accepted',
      frame: { seq: 2, chunk: { type: 'text-delta', delta: 'hel' } }
    })
    expect(secondDelta).toMatchObject({
      status: 'accepted',
      frame: { seq: 3, chunk: { type: 'text-delta', delta: 'lo' } }
    })
    // Stored/broadcast frames merge adjacent deltas: seq advances to the
    // merged tail, the delta text is concatenated.
    expect(streams.snapshot('chat-1')?.frames).toMatchObject([
      { seq: 1, chunk: { type: 'text-start', id: 'text-1' } },
      { seq: 3, chunk: { type: 'text-delta', id: 'text-1', delta: 'hello' } }
    ])
    expect(events).toMatchObject([
      { kind: 'run-state', status: 'running' },
      {
        kind: 'run-frame-batch',
        chatId: 'chat-1',
        runId: 'run-1',
        frames: [
          { seq: 1, chunk: { type: 'text-start', id: 'text-1' } },
          { seq: 3, chunk: { type: 'text-delta', delta: 'hello' } }
        ]
      }
    ])
  })

  it('delivers pending frames on the tick timer without an explicit flush', () => {
    vi.useFakeTimers()
    try {
      const events: ChatEvent[] = []
      const streams = createChatRunSessionRegistry({
        deliver: (event) => events.push(event),
        batchMs: 33
      })
      streams.start('chat-1', 'run-1', baseMessages)
      streams.publish('chat-1', { type: 'text-start', id: 't1' }, { runId: 'run-1' })
      streams.publish('chat-1', { type: 'text-delta', id: 't1', delta: 'hi' }, { runId: 'run-1' })

      expect(events.filter((event) => event.kind === 'run-frame-batch')).toHaveLength(0)
      vi.advanceTimersByTime(40)

      const batches = events.filter((event) => event.kind === 'run-frame-batch')
      expect(batches).toHaveLength(1)
      expect(batches[0]).toMatchObject({
        frames: [
          { seq: 1, chunk: { type: 'text-start' } },
          { seq: 2, chunk: { type: 'text-delta', delta: 'hi' } }
        ]
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never extends a frame that was already delivered in a batch', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({
      deliver: (event) => events.push(event),
      batchMs: 1000
    })
    streams.start('chat-1', 'run-1', baseMessages)

    streams.publish('chat-1', { type: 'text-delta', id: 't1', delta: 'AB' }, { runId: 'run-1' })
    streams.flush('chat-1')
    streams.publish('chat-1', { type: 'text-delta', id: 't1', delta: 'CD' }, { runId: 'run-1' })
    streams.flush('chat-1')

    const batches = events.filter((event) => event.kind === 'run-frame-batch')
    expect(batches).toMatchObject([
      { frames: [{ seq: 1, chunk: { delta: 'AB' } }] },
      { frames: [{ seq: 2, chunk: { delta: 'CD' } }] }
    ])
    // Delivered frames are immutable history: the buffer keeps both.
    expect(streams.snapshot('chat-1')?.frames).toMatchObject([
      { seq: 1, chunk: { delta: 'AB' } },
      { seq: 2, chunk: { delta: 'CD' } }
    ])
  })

  it('never extends a frame captured by a snapshot (merge barrier)', () => {
    const streams = createChatRunSessionRegistry({ batchMs: 1000 })
    streams.start('chat-1', 'run-1', baseMessages)

    streams.publish('chat-1', { type: 'text-delta', id: 't1', delta: 'AB' }, { runId: 'run-1' })
    const captured = streams.snapshot('chat-1')
    streams.publish('chat-1', { type: 'text-delta', id: 't1', delta: 'CD' }, { runId: 'run-1' })

    // The captured snapshot must not be retroactively polluted...
    expect(captured?.frames).toMatchObject([{ seq: 1, chunk: { delta: 'AB' } }])
    // ...and the live buffer keeps the post-snapshot delta as a separate frame
    // so an attached renderer (which replayed seq 1) receives only 'CD'.
    expect(streams.snapshot('chat-1')?.frames).toMatchObject([
      { seq: 1, chunk: { delta: 'AB' } },
      { seq: 2, chunk: { delta: 'CD' } }
    ])
  })

  it('carries a structured error on the terminal run-state event', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({ deliver: (event) => events.push(event) })

    streams.start('chat-1', 'run-1', baseMessages)
    const terminal = streams.finish('chat-1', 'run-1', 'failed', {
      code: 'CHAT_RUN_FAILED',
      message: 'provider exploded'
    })

    expect(terminal).toEqual({
      kind: 'run-state',
      chatId: 'chat-1',
      runId: 'run-1',
      runKind: 'chat',
      status: 'failed',
      error: { code: 'CHAT_RUN_FAILED', message: 'provider exploded' }
    })
    expect(events.at(-1)).toEqual(terminal)
    expect(streams.finish('chat-1', 'run-1', 'finished')).toBeNull()
  })

  it('flushes buffered frames before the terminal run-state event', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({
      deliver: (event) => events.push(event),
      batchMs: 1000
    })
    streams.start('chat-1', 'run-1', baseMessages)
    streams.publish('chat-1', { type: 'text-delta', id: 't1', delta: 'tail' }, { runId: 'run-1' })
    streams.finish('chat-1', 'run-1', 'finished')

    expect(events.map((event) => event.kind)).toEqual(['run-state', 'run-frame-batch', 'run-state'])
  })

  it('threads runKind through start, snapshot, and terminal events for compaction runs', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({ deliver: (event) => events.push(event) })

    expect(streams.start('chat-1', 'run-1', baseMessages, { runKind: 'compaction' })).toEqual({
      kind: 'run-state',
      chatId: 'chat-1',
      runId: 'run-1',
      runKind: 'compaction',
      status: 'running'
    })
    expect(streams.snapshot('chat-1')).toMatchObject({ runKind: 'compaction' })
    expect(streams.finish('chat-1', 'run-1', 'aborted')).toMatchObject({
      runKind: 'compaction',
      status: 'aborted'
    })
  })

  it('emits an aborted terminal event when a new run supersedes an active run', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({ deliver: (event) => events.push(event) })

    streams.start('chat-1', 'run-1', baseMessages)
    streams.start('chat-1', 'run-2', baseMessages)

    expect(events).toMatchObject([
      { kind: 'run-state', runId: 'run-1', status: 'running' },
      { kind: 'run-state', runId: 'run-1', status: 'aborted' },
      { kind: 'run-state', runId: 'run-2', status: 'running' }
    ])
    expect(streams.finish('chat-1', 'run-1', 'finished')).toBeNull()
    expect(streams.snapshot('chat-1')).toMatchObject({ runId: 'run-2' })
  })

  // Coordination-invariant guards (see the ChatRunSessionRegistry doc comment).
  // The deferred-run finish choreography drives `finish` from multiple code
  // paths for the same runId and relies on finish-by-deletion being idempotent.
  it('INVARIANT: a duplicate terminal finish is a no-op and does not re-broadcast', () => {
    const events: ChatEvent[] = []
    const streams = createChatRunSessionRegistry({ deliver: (event) => events.push(event) })

    streams.start('chat-1', 'run-1', baseMessages)
    const terminal = streams.finish('chat-1', 'run-1', 'finished')
    expect(terminal).not.toBeNull()

    const terminalCount = events.filter(
      (event) => event.kind === 'run-state' && event.status !== 'running'
    ).length
    expect(terminalCount).toBe(1)

    // A second finish for the same runId (e.g. engine finally + turn-loop finally)
    // must return null and must not deliver another terminal event.
    expect(streams.finish('chat-1', 'run-1', 'aborted')).toBeNull()
    const terminalCountAfter = events.filter(
      (event) => event.kind === 'run-state' && event.status !== 'running'
    ).length
    expect(terminalCountAfter).toBe(1)
  })

  it('INVARIANT: publish after finish is stale because the session is deleted', () => {
    const streams = createChatRunSessionRegistry()
    streams.start('chat-1', 'run-1', baseMessages)
    streams.finish('chat-1', 'run-1', 'finished')

    expect(streams.publish('chat-1', { type: 'text-start', id: 't1' }, { runId: 'run-1' })).toEqual(
      { status: 'stale' }
    )
    expect(streams.snapshot('chat-1')).toBeNull()
  })
})
