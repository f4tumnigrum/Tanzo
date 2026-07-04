import type { TanzoUIMessage } from '@shared/agent-message'
import { splitAssistantSteps } from '@shared/message-steps'
import type { SqlDatabase } from './types'

/**
 * Migration 22 — per-step message rows (context compaction v2, design §4.5).
 *
 * Historical assistant rows aggregate a whole model pass (parts delimited by
 * `step-start`). This migration splits every multi-step assistant row into one
 * row per step group so that compaction cuts always cover whole rows:
 *
 * - rows are renumbered per conversation into a dense seq block, preserving
 *   order, with fragments inserted in place of their source row;
 * - compaction overlay coverage (`covers_from_seq/covers_to_seq`) is remapped
 *   onto the new seq numbers;
 * - revisions of split messages are dropped — the log projection COALESCEs the
 *   latest revision over the base row, so a stale aggregated revision would
 *   otherwise shadow the fragment content.
 */

interface MessageRow {
  id: string
  seq: number
  role: string
  message_json: string
  metadata_json: string | null
  created_at: number
}

interface OverlayRow {
  id: string
  covers_from_seq: number
  covers_to_seq: number
}

const MESSAGE_SCHEMA_VERSION = 1

function decodeMessage(json: string): TanzoUIMessage | null {
  try {
    const parsed = JSON.parse(json) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof (parsed as { v?: unknown }).v === 'number'
    ) {
      return (parsed as { message: TanzoUIMessage }).message
    }
    return parsed as TanzoUIMessage
  } catch {
    return null
  }
}

function encodeMessage(message: TanzoUIMessage): string {
  return JSON.stringify({ v: MESSAGE_SCHEMA_VERSION, message })
}

export function migratePerStepMessages(db: SqlDatabase): void {
  const selectConversations = db.prepare('SELECT DISTINCT conversation_id AS id FROM messages')
  const selectRows = db.prepare(`
    SELECT
      m.id,
      m.seq,
      m.role,
      COALESCE(r.message_json, m.message_json) AS message_json,
      m.metadata_json,
      m.created_at
    FROM messages m
    LEFT JOIN message_revisions r
      ON r.conversation_id = m.conversation_id
     AND r.message_id = m.id
     AND r.revision = (
       SELECT MAX(revision)
       FROM message_revisions
       WHERE conversation_id = m.conversation_id AND message_id = m.id
     )
    WHERE m.conversation_id = ?
    ORDER BY m.seq
  `)
  const deleteRows = db.prepare('DELETE FROM messages WHERE conversation_id = ?')
  const insertRow = db.prepare(`
    INSERT INTO messages (conversation_id, id, seq, role, message_json, metadata_json, created_at)
    VALUES (@conversation_id, @id, @seq, @role, @message_json, @metadata_json, @created_at)
  `)
  const deleteRevisions = db.prepare(
    'DELETE FROM message_revisions WHERE conversation_id = ? AND message_id = ?'
  )
  const selectOverlays = db.prepare(
    'SELECT id, covers_from_seq, covers_to_seq FROM compaction_overlays WHERE conversation_id = ?'
  )
  const updateOverlay = db.prepare(
    'UPDATE compaction_overlays SET covers_from_seq = ?, covers_to_seq = ? WHERE conversation_id = ? AND id = ?'
  )

  const conversations = selectConversations.all() as Array<{ id: string }>
  for (const { id: chatId } of conversations) {
    const rows = selectRows.all([chatId]) as MessageRow[]

    // Split each row; remember where every original seq lands.
    interface NextRow {
      id: string
      role: string
      message_json: string
      metadata_json: string | null
      created_at: number
    }
    const next: NextRow[] = []
    const firstNewSeq = new Map<number, number>()
    const lastNewSeq = new Map<number, number>()
    let anySplit = false
    for (const row of rows) {
      firstNewSeq.set(row.seq, next.length)
      const decoded = decodeMessage(row.message_json)
      const fragments = decoded ? splitAssistantSteps(decoded) : null
      if (!fragments || fragments.length <= 1) {
        // Single-step or unparseable row — keep it verbatim (id, json, all).
        next.push({
          id: row.id,
          role: row.role,
          message_json: row.message_json,
          metadata_json: row.metadata_json,
          created_at: row.created_at
        })
      } else {
        anySplit = true
        deleteRevisions.run([chatId, row.id])
        for (const fragment of fragments) {
          next.push({
            id: fragment.id,
            role: row.role,
            message_json: encodeMessage(fragment),
            metadata_json: fragment.metadata ? JSON.stringify(fragment.metadata) : null,
            created_at: row.created_at
          })
        }
      }
      lastNewSeq.set(row.seq, next.length - 1)
    }
    if (!anySplit) continue

    deleteRows.run([chatId])
    next.forEach((entry, seq) => {
      insertRow.run({
        conversation_id: chatId,
        id: entry.id,
        seq,
        role: entry.role,
        message_json: entry.message_json,
        metadata_json: entry.metadata_json,
        created_at: entry.created_at
      })
    })

    // Remap overlay coverage onto the new seq numbers.
    const oldSeqs = rows.map((row) => row.seq)
    const overlays = selectOverlays.all([chatId]) as OverlayRow[]
    for (const overlay of overlays) {
      const from = oldSeqs.find((seq) => seq >= overlay.covers_from_seq)
      const to = [...oldSeqs].reverse().find((seq) => seq <= overlay.covers_to_seq)
      if (from === undefined || to === undefined || from > to) continue
      updateOverlay.run([firstNewSeq.get(from)!, lastNewSeq.get(to)!, chatId, overlay.id])
    }
  }
}
