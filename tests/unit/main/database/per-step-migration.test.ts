import { describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import { migratePerStepMessages } from '@main/database/per-step-migration'
import { createRealDb, type RealDb } from '../../../helpers/real-db'

function encode(message: TanzoUIMessage): string {
  return JSON.stringify({ v: 1, message })
}

function insertConversation(db: RealDb, id: string): void {
  db.prepare(
    `INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
     VALUES ('w1', 'w', '/tmp', 0, 0)
     ON CONFLICT (id) DO NOTHING`
  ).run()
  db.prepare(
    `INSERT INTO conversations (id, workspace_id, title, created_at, updated_at)
     VALUES (?, 'w1', '', 0, 0)`
  ).run([id])
}

function insertMessage(db: RealDb, chatId: string, message: TanzoUIMessage, seq: number): void {
  db.prepare(
    `INSERT INTO messages (conversation_id, id, seq, role, message_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run([
    chatId,
    message.id,
    seq,
    message.role,
    encode(message),
    message.metadata ? JSON.stringify(message.metadata) : null,
    1000 + seq
  ])
}

function loadRows(db: RealDb, chatId: string): Array<{ id: string; seq: number; parts: number }> {
  const rows = db
    .prepare('SELECT id, seq, message_json FROM messages WHERE conversation_id = ? ORDER BY seq')
    .all([chatId]) as Array<{ id: string; seq: number; message_json: string }>
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    parts: (JSON.parse(row.message_json) as { message: TanzoUIMessage }).message.parts.length
  }))
}

const USER: TanzoUIMessage = {
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text: 'go' }]
} as TanzoUIMessage

const MULTI_STEP: TanzoUIMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [
    { type: 'step-start' },
    { type: 'text', text: 'one' },
    { type: 'step-start' },
    { type: 'text', text: 'two' }
  ],
  metadata: {
    steps: [
      { stepNumber: 1, usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } },
      { stepNumber: 2, usage: { inputTokens: 20, outputTokens: 1, totalTokens: 21 } }
    ]
  }
} as TanzoUIMessage

describe('database/per-step-migration', () => {
  it('splits multi-step assistant rows and renumbers seq densely', () => {
    const db = createRealDb() // migration 22 runs on empty tables; re-run manually below
    insertConversation(db, 'c1')
    insertMessage(db, 'c1', USER, 0)
    insertMessage(db, 'c1', MULTI_STEP, 1)
    insertMessage(db, 'c1', { ...USER, id: 'u2' }, 2)

    migratePerStepMessages(db)

    expect(loadRows(db, 'c1')).toEqual([
      { id: 'u1', seq: 0, parts: 1 },
      { id: 'a1', seq: 1, parts: 2 },
      { id: 'a1::step-1', seq: 2, parts: 2 },
      { id: 'u2', seq: 3, parts: 1 }
    ])
  })

  it('leaves conversations without multi-step rows untouched (seq preserved)', () => {
    const db = createRealDb()
    insertConversation(db, 'c1')
    insertMessage(db, 'c1', USER, 5)
    insertMessage(db, 'c1', { ...USER, id: 'u2' }, 9)

    migratePerStepMessages(db)

    expect(loadRows(db, 'c1').map((row) => row.seq)).toEqual([5, 9])
  })

  it('remaps compaction overlay coverage onto the new seq numbers', () => {
    const db = createRealDb()
    insertConversation(db, 'c1')
    insertMessage(db, 'c1', { ...USER, id: 'old-1' }, 0)
    insertMessage(db, 'c1', MULTI_STEP, 1)
    insertMessage(db, 'c1', { ...USER, id: 'u2' }, 2)
    db.prepare(
      `INSERT INTO compaction_overlays (conversation_id, id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, created_at)
       VALUES ('c1', 's1', 1, 0, 1, 'summary', NULL, 0)`
    ).run()

    migratePerStepMessages(db)

    const overlay = db
      .prepare(
        'SELECT covers_from_seq, covers_to_seq FROM compaction_overlays WHERE conversation_id = ?'
      )
      .get(['c1']) as { covers_from_seq: number; covers_to_seq: number }
    // Old coverage [0,1] (old-1 + whole a1) now spans old-1 through the last
    // fragment of a1.
    expect(overlay).toEqual({ covers_from_seq: 0, covers_to_seq: 2 })
  })

  it('splits the latest revision content and drops stale aggregated revisions', () => {
    const db = createRealDb()
    insertConversation(db, 'c1')
    // Base row is a stale single-step aggregate...
    insertMessage(db, 'c1', { ...MULTI_STEP, parts: MULTI_STEP.parts.slice(0, 2) }, 0)
    // ...whose latest revision carries the full two-step content.
    db.prepare(
      `INSERT INTO message_revisions (conversation_id, message_id, revision, message_json, created_at)
       VALUES ('c1', 'a1', 1, ?, 0)`
    ).run([encode(MULTI_STEP)])

    migratePerStepMessages(db)

    expect(loadRows(db, 'c1').map((row) => row.id)).toEqual(['a1', 'a1::step-1'])
    const revisions = db
      .prepare(
        'SELECT COUNT(*) AS c FROM message_revisions WHERE conversation_id = ? AND message_id = ?'
      )
      .get(['c1', 'a1']) as { c: number }
    expect(revisions.c).toBe(0)
  })
})
