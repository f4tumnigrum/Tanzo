import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { SqlDatabase } from '@main/database/types'
import { createMessageRepo } from '@main/agent/repositories/message-repo'
import { createRealDb, type RealDb } from '../../../../helpers/real-db'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function seedConversation(db: RealDb, chatId: string): void {
  db.exec(`
    INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
      VALUES ('ws', 'ws', '/tmp/ws', 0, 0);
    INSERT INTO conversations (id, workspace_id, title, created_at, updated_at)
      VALUES ('${chatId}', 'ws', 't', 0, 0);
  `)
}

function userMessage(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

function assistantMessage(id: string, text: string): TanzoUIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

function summaryMessage(summaryId: string): TanzoUIMessage {
  return {
    id: summaryId,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'summary' },
      { type: 'data-compaction', data: { stage: 'complete', summaryId } }
    ]
  } as TanzoUIMessage
}

function insertRawMessage(db: RealDb, chatId: string, message: TanzoUIMessage, seq: number): void {
  db.prepare(
    `INSERT INTO messages (conversation_id, id, seq, role, message_json, created_at)
       VALUES (@conversation_id, @id, @seq, @role, @message_json, @created_at)`
  ).run({
    conversation_id: chatId,
    id: message.id,
    seq,
    role: message.role,
    message_json: JSON.stringify({ v: 1, message }),
    created_at: 0
  })
}

/**
 * Wrap a db so we can count how many times the full active-log SELECT runs.
 * That query is uniquely identified by the exact `selectLog` WHERE/ORDER tail;
 * `selectRowsAfterSeq`/`selectRowsInSeqRange` carry an extra `AND m.seq ...`.
 */
function instrumentLogSelect(source: RealDb): {
  db: SqlDatabase
  logSelectCount: () => number
} {
  let count = 0
  const wrapped: SqlDatabase = {
    exec: (sql) => source.exec(sql),
    transaction: (fn) => source.transaction(fn),
    pragma: (directive) => source.pragma(directive),
    close: () => source.close(),
    prepare: (sql) => {
      const stmt = source.prepare(sql)
      if (!sql.includes('WHERE m.conversation_id = ? ORDER BY m.seq')) return stmt
      return {
        run: (params) => stmt.run(params),
        get: (params) => stmt.get(params),
        all: (params) => {
          count += 1
          return stmt.all(params)
        }
      }
    }
  }
  return { db: wrapped, logSelectCount: () => count }
}

describe('message-repo (real sqlite engine)', () => {
  let db: RealDb

  beforeEach(() => {
    db = createRealDb()
    seedConversation(db, 'c1')
  })

  afterEach(() => {
    db.close()
  })

  it('round-trips active messages by id and order', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    const loaded = await repo.load('c1')
    expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('incrementally updates only changed rows on writeActive', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'changed')])
    const loaded = await repo.load('c1')
    expect(loaded.map((m) => (m.parts[0] as { text: string }).text)).toEqual(['one', 'changed'])
    expect(
      db
        .prepare(
          'SELECT message_id, revision FROM message_revisions WHERE conversation_id = ? ORDER BY message_id, revision'
        )
        .all(['c1'])
    ).toEqual([
      { message_id: 'm1', revision: 1 },
      { message_id: 'm2', revision: 1 },
      { message_id: 'm2', revision: 2 }
    ])
    expect(
      db
        .prepare('SELECT message_json FROM messages WHERE conversation_id = ? AND id = ?')
        .get(['c1', 'm2'])
    ).toEqual({ message_json: JSON.stringify({ v: 1, message: userMessage('m2', 'two') }) })
  })

  it('preserves created_at across diff rewrites of the same message', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one')])
    const original = (
      db.prepare('SELECT created_at FROM messages WHERE id = ?').get(['m1']) as {
        created_at: number
      }
    ).created_at

    await new Promise((resolve) => setTimeout(resolve, 5))
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])

    const after = (
      db.prepare('SELECT created_at FROM messages WHERE id = ?').get(['m1']) as {
        created_at: number
      }
    ).created_at
    expect(after).toBe(original)
  })

  it('keeps retained log message created_at when compaction records an overlay', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    const original = (
      db.prepare('SELECT created_at FROM messages WHERE id = ?').get(['m2']) as {
        created_at: number
      }
    ).created_at

    await new Promise((resolve) => setTimeout(resolve, 5))
    repo.finalizeCompaction('c1', ['m1'], 'sum', [summaryMessage('sum'), userMessage('m2', 'two')])

    const after = (
      db.prepare('SELECT created_at FROM messages WHERE id = ?').get(['m2']) as {
        created_at: number
      }
    ).created_at
    expect(after).toBe(original)
  })

  it('records compaction as an overlay and leaves the log intact', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    expect(() =>
      repo.finalizeCompaction('c1', ['m1', 'm2'], 'sum', [summaryMessage('sum')])
    ).not.toThrow()

    expect((await repo.load('c1')).map((m) => m.id)).toEqual(['sum'])
    expect((await repo.loadArchived('c1', 'sum')).map((m) => m.id)).toEqual(['m1', 'm2'])
    expect((await repo.loadFullHistory('c1')).map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('uses prior overlay coverage when compacting a previous summary', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    repo.finalizeCompaction('c1', ['m1'], 'sum', [summaryMessage('sum'), userMessage('m2', 'two')])

    repo.writeActive('c1', [
      summaryMessage('sum'),
      userMessage('m2', 'two'),
      userMessage('m3', 'three')
    ])
    expect((await repo.load('c1')).map((m) => m.id)).toEqual(['sum', 'm2', 'm3'])

    expect(() =>
      repo.finalizeCompaction(
        'c1',
        ['sum', 'm2'],
        'sum2',
        [summaryMessage('sum2'), userMessage('m3', 'three')],
        ['sum', 'm2', 'm3']
      )
    ).not.toThrow()
    expect((await repo.load('c1')).map((m) => m.id)).toEqual(['sum2', 'm3'])
    expect((await repo.loadArchived('c1', 'sum2')).map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('orders a synthesized tail fragment after the summary, not at the log end', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [
      userMessage('u1', 'one'),
      assistantMessage('a2', 'reply two'),
      userMessage('u3', 'three'),
      assistantMessage('a3', 'reply three')
    ])

    // A mid-message (partial) split archives the original assistant message and
    // emits a fresh tail fragment that belongs immediately after the summary.
    repo.finalizeCompaction('c1', ['u1', 'a2'], 'sum', [
      summaryMessage('sum'),
      assistantMessage('frag', 'late part of a2'),
      userMessage('u3', 'three'),
      assistantMessage('a3', 'reply three')
    ])

    expect((await repo.load('c1')).map((m) => m.id)).toEqual(['sum', 'frag', 'u3', 'a3'])
    expect((await repo.loadDisplay('c1')).map((m) => m.id)).toEqual([
      'u1',
      'a2',
      'sum',
      'frag',
      'u3',
      'a3'
    ])
    expect((await repo.loadFullHistory('c1')).map((m) => m.id)).toEqual([
      'u1',
      'a2',
      'frag',
      'u3',
      'a3'
    ])
    expect((await repo.loadArchived('c1', 'sum')).map((m) => m.id)).toEqual(['u1', 'a2'])
  })

  it('loadFullHistory returns the raw message log after compaction', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [
      userMessage('m1', 'one'),
      userMessage('m2', 'two'),
      userMessage('m3', 'three')
    ])
    repo.finalizeCompaction('c1', ['m1', 'm2'], 'sum', [
      summaryMessage('sum'),
      userMessage('m3', 'three')
    ])

    expect((await repo.loadFullHistory('c1')).map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('load context resolves nested overlays without adding summaries to the log', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [
      userMessage('m1', 'one'),
      userMessage('m2', 'two'),
      userMessage('m3', 'three')
    ])
    repo.finalizeCompaction('c1', ['m1', 'm2'], 'sum1', [
      summaryMessage('sum1'),
      userMessage('m3', 'three')
    ])
    repo.writeActive('c1', [
      summaryMessage('sum1'),
      userMessage('m3', 'three'),
      userMessage('m4', 'four')
    ])
    repo.finalizeCompaction('c1', ['sum1', 'm3'], 'sum2', [
      summaryMessage('sum2'),
      userMessage('m4', 'four')
    ])

    expect((await repo.load('c1')).map((m) => m.id)).toEqual(['sum2', 'm4'])
    expect((await repo.loadFullHistory('c1')).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('loadFullHistory returns an empty list for a conversation with no active messages', async () => {
    const repo = createMessageRepo(db, logger)
    expect(await repo.loadFullHistory('c1')).toEqual([])
  })

  it('rolls back writeActive when a multi-statement update fails', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])

    expect(() =>
      repo.writeActive('c1', [userMessage('m1', 'changed'), userMessage('m1', 'duplicate')])
    ).toThrow()

    const loaded = await repo.load('c1')
    expect(loaded.map((m) => [m.id, (m.parts[0] as { text: string }).text])).toEqual([
      ['m1', 'one'],
      ['m2', 'two']
    ])
  })

  it('salvages a message by dropping an invalid part instead of discarding it', async () => {
    const repo = createMessageRepo(db, logger)
    const interrupted = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'partial reply' },
        {
          type: 'tool-fileRead',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { path: 123 }
        }
      ]
    } as unknown as TanzoUIMessage
    insertRawMessage(db, 'c1', interrupted, 0)

    const loaded = await repo.load('c1')

    expect(loaded.map((m) => m.id)).toEqual(['a1'])
    expect(loaded[0].parts).toEqual([{ type: 'text', text: 'partial reply' }])
    const quarantined = db
      .prepare('SELECT id FROM quarantined_messages WHERE conversation_id = ?')
      .all(['c1']) as Array<{ id: string }>
    expect(quarantined).toHaveLength(0)
  })

  it('quarantines a message only when no part can be salvaged', async () => {
    const repo = createMessageRepo(db, logger)
    const broken = {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-fileRead',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { path: 123 }
        }
      ]
    } as unknown as TanzoUIMessage
    insertRawMessage(db, 'c1', broken, 0)

    const loaded = await repo.load('c1')

    expect(loaded).toHaveLength(0)
    const quarantined = db
      .prepare('SELECT id FROM quarantined_messages WHERE conversation_id = ?')
      .all(['c1']) as Array<{ id: string }>
    expect(quarantined.map((row) => row.id)).toEqual(['a1'])
  })

  it('hydrates the write mirror once and skips the full-log SELECT on later writes', async () => {
    const { db: instrumented, logSelectCount } = instrumentLogSelect(db)
    const repo = createMessageRepo(instrumented, logger)

    repo.writeActive('c1', [userMessage('u1', 'hi'), assistantMessage('a1', '')])
    const afterHydration = logSelectCount()
    expect(afterHydration).toBe(1)

    // 20 streaming steps growing the same assistant message. Each step used to
    // re-run the full active-log SELECT inside the write transaction.
    for (let i = 1; i <= 20; i += 1) {
      repo.writeActive('c1', [userMessage('u1', 'hi'), assistantMessage('a1', 'x'.repeat(i))])
    }

    // The mirror served every subsequent write, so no extra full-log SELECT ran.
    expect(logSelectCount()).toBe(afterHydration)

    const loaded = await repo.load('c1')
    expect((loaded[1].parts[0] as { text: string }).text).toBe('x'.repeat(20))
  })

  it('restarts seq numbering after deleteAll invalidates the mirror', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    repo.deleteAll('c1')
    repo.writeActive('c1', [userMessage('m3', 'three')])
    expect(
      db.prepare('SELECT id, seq FROM messages WHERE conversation_id = ? ORDER BY seq').all(['c1'])
    ).toEqual([{ id: 'm3', seq: 0 }])
  })

  it('reuses renumbered seqs after finalizeCompaction invalidates the mirror', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])
    repo.finalizeCompaction('c1', ['m1'], 'sum', [summaryMessage('sum'), userMessage('m2', 'two')])

    // After compaction renumbers the retained tail, a fresh append must land on
    // a seq computed from the current DB state, not a stale cached counter.
    expect(() =>
      repo.writeActive('c1', [
        summaryMessage('sum'),
        userMessage('m2', 'two'),
        userMessage('m3', 'three')
      ])
    ).not.toThrow()
    expect((await repo.load('c1')).map((m) => m.id)).toEqual(['sum', 'm2', 'm3'])
  })

  it('re-hydrates the mirror after a rolled-back writeActive', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one')])
    expect(() => repo.writeActive('c1', [userMessage('m2', 'a'), userMessage('m2', 'b')])).toThrow()
    // The failed m2 insert was rolled back and the mirror discarded, so the next
    // write appends at seq 1 instead of a stale seq left behind by the abort.
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m3', 'three')])
    expect(
      db.prepare('SELECT id, seq FROM messages WHERE conversation_id = ? ORDER BY seq').all(['c1'])
    ).toEqual([
      { id: 'm1', seq: 0 },
      { id: 'm3', seq: 1 }
    ])
  })

  it('serves repeated loads from the validation cache (same object identity)', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'hello'), userMessage('m2', 'world')])

    const first = await repo.loadDisplay('c1')
    const second = await repo.loadDisplay('c1')

    // Identical references prove Zod validation did not re-run on the second load.
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  it('revalidates only the message whose content changed between loads', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'stable'), assistantMessage('a1', 'draft')])
    const first = await repo.loadDisplay('c1')

    repo.writeActive('c1', [userMessage('m1', 'stable'), assistantMessage('a1', 'final')])
    const second = await repo.loadDisplay('c1')

    // Unchanged message comes from the cache; changed message is a fresh object.
    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect((second[1].parts[0] as { text: string }).text).toBe('final')
  })

  it('shares the validation cache across load variants', async () => {
    const repo = createMessageRepo(db, logger)
    repo.writeActive('c1', [userMessage('m1', 'one'), userMessage('m2', 'two')])

    const display = await repo.loadDisplay('c1')
    const history = await repo.loadFullHistory('c1')
    const context = await repo.load('c1')

    // All read paths flow through validateRows and reuse the same entries.
    expect(history[0]).toBe(display[0])
    expect(history[1]).toBe(display[1])
    expect(context[0]).toBe(display[0])
    expect(context[1]).toBe(display[1])
  })
})
