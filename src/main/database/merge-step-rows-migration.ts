import type { TanzoUIMessage } from '@shared/agent-message'
import { groupAssistantSteps, isStepFragmentOf } from '@shared/message-steps'
import type { SqlDatabase } from './types'

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

export function mergeStepMessageRows(db: SqlDatabase): void {
  const selectConversations = db.prepare('SELECT DISTINCT conversation_id AS id FROM messages')
  const selectRows = db.prepare(`
    SELECT id, seq, role, message_json, metadata_json, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY seq
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

    interface NextRow {
      id: string
      role: string
      message_json: string
      metadata_json: string | null
      created_at: number
    }
    const next: NextRow[] = []

    const newSeqOf = new Map<number, number>()
    let anyMerge = false

    let i = 0
    while (i < rows.length) {
      const row = rows[i]
      const decoded = decodeMessage(row.message_json)

      const group: Array<{ row: MessageRow; message: TanzoUIMessage }> = []
      if (decoded && row.role === 'assistant') {
        group.push({ row, message: decoded })
        let j = i + 1
        while (j < rows.length && rows[j].role === 'assistant') {
          const candidate = rows[j]
          if (!isStepFragmentOf(group[group.length - 1].row.id, candidate.id)) break
          const candidateDecoded = decodeMessage(candidate.message_json)
          if (!candidateDecoded) break
          group.push({ row: candidate, message: candidateDecoded })
          j += 1
        }
      }

      if (group.length <= 1) {
        newSeqOf.set(row.seq, next.length)
        next.push({
          id: row.id,
          role: row.role,
          message_json: row.message_json,
          metadata_json: row.metadata_json,
          created_at: row.created_at
        })
        i += 1
        continue
      }

      anyMerge = true
      const merged = groupAssistantSteps(group.map((entry) => entry.message))[0]
      for (const entry of group) {
        newSeqOf.set(entry.row.seq, next.length)
        deleteRevisions.run([chatId, entry.row.id])
      }
      next.push({
        id: merged.id,
        role: 'assistant',
        message_json: encodeMessage(merged),
        metadata_json: merged.metadata ? JSON.stringify(merged.metadata) : null,
        created_at: group[0].row.created_at
      })
      i += group.length
    }

    if (!anyMerge) continue

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

    const oldSeqs = rows.map((row) => row.seq)
    const overlays = selectOverlays.all([chatId]) as OverlayRow[]
    for (const overlay of overlays) {
      const from = oldSeqs.find((seq) => seq >= overlay.covers_from_seq)
      const to = [...oldSeqs].reverse().find((seq) => seq <= overlay.covers_to_seq)
      if (from === undefined || to === undefined || from > to) continue
      updateOverlay.run([newSeqOf.get(from)!, newSeqOf.get(to)!, chatId, overlay.id])
    }
  }
}
