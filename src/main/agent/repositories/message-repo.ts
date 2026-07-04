import { safeValidateUIMessages } from 'ai'
import type { TanzoDataParts, TanzoUIMessage } from '@shared/agent-message'
import { TanzoOperationError } from '@shared/errors'
import type { SqlDatabase } from '../../database/types'
import type { Logger } from '../logging'
import { validationDataSchemas, validationTools } from '../tools/message-schemas'

const MESSAGE_SCHEMA_VERSION = 1
const QUARANTINE_REASON_LIMIT = 2000

interface StoredMessageRow {
  id: string
  seq: number
  message_json: string
  created_at: number
}

/**
 * Per-conversation in-memory mirror of the persisted message state.
 *
 * Maintained incrementally so that `writeActive` can skip the full-table
 * SELECT on every streaming step and only write rows that actually changed.
 * The mirror is the single source of truth for what is currently in the DB;
 * it is invalidated (deleted from the outer Map) whenever an operation could
 * change row content or sequence numbers outside of `writeActive`.
 */
interface ChatMirrorState {
  /** msgId → effective encoded JSON (COALESCE of latest revision or original row) */
  messages: Map<string, string>
  /** Next seq value to assign to new inserts for this conversation */
  nextSeq: number
}

interface IdRow {
  id: string
}

interface SeqRow {
  seq: number
}

interface GenerationRow {
  generation: number
}

interface CompactionOverlayRow {
  id: string
  generation: number
  covers_from_seq: number
  covers_to_seq: number
  summary_text: string
  usage_json: string | null
  created_at: number
}

export interface MessageRepo {
  deleteAll(chatId: string): void
  writeActive(chatId: string, messages: TanzoUIMessage[]): void
  /**
   * Copy the source conversation's compaction overlays that are fully covered
   * by the rows copied into the target (a fork). Coverage seqs are remapped
   * from source row seqs to target row seqs by message id. Pure inserts — the
   * compaction pipeline itself is untouched.
   */
  copyOverlaysForFork(sourceChatId: string, targetChatId: string): void
  finalizeCompaction(
    chatId: string,
    archivedIds: string[],
    summaryId: string,
    next: TanzoUIMessage[],
    expectedActiveIds?: string[]
  ): void
  /** Context-window projection: latest compaction summary plus messages after its coverage. */
  load(chatId: string): Promise<TanzoUIMessage[]>
  /** Raw append log, without synthetic compaction summaries. */
  loadUnvalidated(chatId: string): TanzoUIMessage[]
  /** Messages covered by a compaction overlay. */
  loadArchived(chatId: string, summaryId: string): Promise<TanzoUIMessage[]>
  /** Full historical log, in seq order. */
  loadFullHistory(chatId: string): Promise<TanzoUIMessage[]>
  /** Full historical log with synthetic overlay markers inserted for UI rendering. */
  loadDisplay(chatId: string): Promise<TanzoUIMessage[]>
}

export function createMessageRepo(db: SqlDatabase, logger: Logger): MessageRepo {
  const deleteMessages = db.prepare('DELETE FROM messages WHERE conversation_id = ?')
  const deleteMessageById = db.prepare('DELETE FROM messages WHERE conversation_id = ? AND id = ?')
  const logProjectionSql = `
    SELECT
      m.id,
      m.seq,
      COALESCE(r.message_json, m.message_json) AS message_json,
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
  `
  const selectLog = db.prepare(`${logProjectionSql} WHERE m.conversation_id = ? ORDER BY m.seq`)
  const selectRowsAfterSeq = db.prepare(
    `${logProjectionSql} WHERE m.conversation_id = ? AND m.seq > ? ORDER BY m.seq`
  )
  const selectRowsInSeqRange = db.prepare(
    `${logProjectionSql} WHERE m.conversation_id = ? AND m.seq BETWEEN ? AND ? ORDER BY m.seq`
  )
  const selectMessageSeqs = db.prepare(
    'SELECT id, seq FROM messages WHERE conversation_id = ? AND id IN (SELECT value FROM json_each(?))'
  )
  const selectOverlays = db.prepare(
    'SELECT id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, created_at FROM compaction_overlays WHERE conversation_id = ? ORDER BY covers_to_seq, generation'
  )
  const selectLatestOverlay = db.prepare(
    'SELECT id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, created_at FROM compaction_overlays WHERE conversation_id = ? ORDER BY generation DESC LIMIT 1'
  )
  const selectOverlayById = db.prepare(
    'SELECT id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, created_at FROM compaction_overlays WHERE conversation_id = ? AND id = ?'
  )
  const selectMaxGeneration = db.prepare(
    'SELECT COALESCE(MAX(generation), 0) AS generation FROM compaction_overlays WHERE conversation_id = ?'
  )
  const insertOverlay = db.prepare(`
    INSERT INTO compaction_overlays (
      conversation_id, id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, created_at
    ) VALUES (
      @conversation_id, @id, @generation, @covers_from_seq, @covers_to_seq, @summary_text, @usage_json, @created_at
    )
  `)
  const selectMaxSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), -1) AS seq FROM messages WHERE conversation_id = ?'
  )
  const selectIdSeqs = db.prepare(
    'SELECT id, seq FROM messages WHERE conversation_id = ? ORDER BY seq'
  )

  // ---------------------------------------------------------------------------
  // Per-conversation write mirror
  // ---------------------------------------------------------------------------

  const chatMirror = new Map<string, ChatMirrorState>()

  /**
   * Pure memoization of the `message_json` → validated `TanzoUIMessage` mapping.
   *
   * `safeValidateUIMessages` is deterministic: identical `message_json` always
   * validates to an identical result.  Keying the cache by the full JSON string
   * means no invalidation is ever required — a revised message produces a new
   * JSON key and is validated fresh, while the superseded entry simply becomes
   * unreachable.  `selectLog.all` only ever returns the latest revision per
   * message, so the live key set is bounded by the number of distinct active
   * message bodies (a few hundred entries in practice), not by revision count.
   */
  const validationCache = new Map<string, TanzoUIMessage>()

  /**
   * Return the mirror for `chatId`, hydrating it from the DB on first access.
   *
   * Hydration runs a single `selectLog.all` — the same query `writeActive`
   * previously executed on every call.  All subsequent `writeActive` calls for
   * the same conversation skip that query entirely and go straight to writes.
   */
  function getOrHydrateMirror(chatId: string): ChatMirrorState {
    const cached = chatMirror.get(chatId)
    if (cached) return cached
    const rows = selectLog.all([chatId]) as StoredMessageRow[]
    let maxSeq = -1
    const mirrorMessages = new Map<string, string>()
    for (const row of rows) {
      mirrorMessages.set(row.id, row.message_json)
      if (row.seq > maxSeq) maxSeq = row.seq
    }
    const state: ChatMirrorState = { messages: mirrorMessages, nextSeq: maxSeq + 1 }
    chatMirror.set(chatId, state)
    return state
  }

  const insertMessage = db.prepare(`
    INSERT INTO messages (
      conversation_id, id, seq, role, message_json, metadata_json, created_at
    ) VALUES (
      @conversation_id, @id, @seq, @role, @message_json, @metadata_json, @created_at
    )
  `)
  const updateMessageSeq = db.prepare(
    'UPDATE messages SET seq = @seq WHERE conversation_id = @conversation_id AND id = @id'
  )
  const insertRevision = db.prepare(`
    INSERT INTO message_revisions (conversation_id, message_id, revision, message_json, created_at)
    VALUES (
      @conversation_id,
      @message_id,
      (SELECT COALESCE(MAX(revision), 0) + 1 FROM message_revisions WHERE conversation_id = @conversation_id AND message_id = @message_id),
      @message_json,
      @created_at
    )
  `)
  const insertQuarantined = db.prepare(`
    INSERT INTO quarantined_messages (
      conversation_id, id, ord, message_json, reason, quarantined_at
    ) VALUES (
      @conversation_id, @id, @ord, @message_json, @reason, @quarantined_at
    )
    ON CONFLICT(conversation_id, id) DO UPDATE SET
      ord = excluded.ord,
      message_json = excluded.message_json,
      reason = excluded.reason,
      quarantined_at = excluded.quarantined_at
  `)

  function encodeMessage(message: TanzoUIMessage): string {
    return JSON.stringify({ v: MESSAGE_SCHEMA_VERSION, message })
  }

  function decodeMessage(json: string): unknown {
    const parsed = JSON.parse(json) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof (parsed as { v?: unknown }).v === 'number'
    ) {
      return (parsed as { message: unknown }).message
    }
    return parsed
  }

  function messageParams(
    chatId: string,
    message: TanzoUIMessage,
    seq: number,
    createdAt?: number
  ): Record<string, unknown> {
    return {
      conversation_id: chatId,
      id: message.id,
      seq,
      role: message.role,
      message_json: encodeMessage(message),
      metadata_json: message.metadata ? JSON.stringify(message.metadata) : null,
      created_at: createdAt ?? message.metadata?.createdAt ?? Date.now()
    }
  }

  function recordRevision(chatId: string, message: TanzoUIMessage, messageJson: string): void {
    insertRevision.run({
      conversation_id: chatId,
      message_id: message.id,
      message_json: messageJson,
      created_at: Date.now()
    })
  }

  function quarantine(chatId: string, row: StoredMessageRow, error: unknown): void {
    logger.warn('quarantined invalid message', { chatId, id: row.id })
    const reason = error instanceof Error ? error.message : String(error)
    db.transaction(() => {
      insertQuarantined.run({
        conversation_id: chatId,
        id: row.id,
        ord: row.seq,
        message_json: row.message_json,
        reason: reason.slice(0, QUARANTINE_REASON_LIMIT),
        quarantined_at: Date.now()
      })
      deleteMessageById.run([chatId, row.id])
    })
    // Row was deleted from DB — remove it from the mirror so the next
    // writeActive call does not treat it as an existing message.
    chatMirror.get(chatId)?.messages.delete(row.id)
  }

  function partsOf(message: unknown): unknown[] | null {
    if (!message || typeof message !== 'object') return null
    const parts = (message as { parts?: unknown }).parts
    return Array.isArray(parts) ? parts : null
  }

  async function validateOne(message: unknown): Promise<TanzoUIMessage | null> {
    const result = await safeValidateUIMessages<TanzoUIMessage>({
      messages: [message],
      dataSchemas: validationDataSchemas,
      tools: validationTools
    })
    return result.success ? (result.data[0] ?? null) : null
  }

  async function salvageMessage(message: unknown): Promise<TanzoUIMessage | null> {
    const parts = partsOf(message)
    if (!parts || parts.length === 0) return null
    const keptParts: unknown[] = []
    for (const part of parts) {
      const candidate = { ...(message as object), parts: [part] }
      if (await validateOne(candidate)) keptParts.push(part)
    }
    if (keptParts.length === 0) return null
    return validateOne({ ...(message as object), parts: keptParts })
  }

  async function validateRows(chatId: string, rows: StoredMessageRow[]): Promise<TanzoUIMessage[]> {
    // Resolve every row that has already been validated in this session.
    const resolved = new Map<number, TanzoUIMessage>()
    const uncached: number[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const hit = validationCache.get(rows[i].message_json)
      if (hit) resolved.set(i, hit)
      else uncached.push(i)
    }

    // Fast path: the whole conversation is cached (steady state after the first
    // load), so no Zod validation runs at all.
    if (uncached.length === 0) return rows.map((_, i) => resolved.get(i) as TanzoUIMessage)

    // Validate only the rows whose content changed since the last load.
    const decoded = uncached.map((i) => ({
      row: rows[i],
      message: decodeMessage(rows[i].message_json)
    }))
    const all = await safeValidateUIMessages<TanzoUIMessage>({
      messages: decoded.map((entry) => entry.message),
      dataSchemas: validationDataSchemas,
      tools: validationTools
    })
    if (all.success) {
      for (let k = 0; k < uncached.length; k += 1) {
        validationCache.set(decoded[k].row.message_json, all.data[k])
        resolved.set(uncached[k], all.data[k])
      }
      return rows.map((_, i) => resolved.get(i) as TanzoUIMessage)
    }

    logger.warn('batch restore failed, falling back to per-message', {
      chatId,
      error: all.error
    })
    for (let k = 0; k < uncached.length; k += 1) {
      const { row, message } = decoded[k]
      const one = await validateOne(message)
      if (one) {
        validationCache.set(row.message_json, one)
        resolved.set(uncached[k], one)
        continue
      }
      const salvaged = await salvageMessage(message)
      if (salvaged) {
        logger.warn('salvaged message by dropping invalid parts', {
          chatId,
          id: row.id
        })
        validationCache.set(row.message_json, salvaged)
        resolved.set(uncached[k], salvaged)
      } else {
        // Quarantined rows are dropped from the output and left uncached.
        quarantine(chatId, row, all.error)
      }
    }
    // Preserve original row order, skipping quarantined rows.
    return rows.map((_, i) => resolved.get(i)).filter((m): m is TanzoUIMessage => m !== undefined)
  }

  function isCompactionSummary(message: TanzoUIMessage): boolean {
    return message.parts.some((part) => part.type === 'data-compaction')
  }

  function validLogMessages(messages: TanzoUIMessage[]): TanzoUIMessage[] {
    return messages.filter((message) => message.parts.length > 0 && !isCompactionSummary(message))
  }

  function compactionData(message: TanzoUIMessage): TanzoDataParts['compaction'] | null {
    for (const part of message.parts) {
      if (part.type === 'data-compaction') return part.data
    }
    return null
  }

  function summaryMessageFromOverlay(overlay: CompactionOverlayRow): TanzoUIMessage {
    const usage = overlay.usage_json
      ? (JSON.parse(overlay.usage_json) as TanzoDataParts['compaction']['usage'])
      : undefined
    const data: TanzoDataParts['compaction'] = {
      stage: 'complete',
      summary: overlay.summary_text,
      summaryId: overlay.id,
      ...(usage ? { usage } : {})
    }
    return {
      id: overlay.id,
      role: 'assistant',
      parts: [
        { type: 'text', text: overlay.summary_text },
        { type: 'data-compaction', data }
      ]
    } as TanzoUIMessage
  }

  function currentContextIds(chatId: string): string[] {
    const overlay = selectLatestOverlay.get([chatId]) as CompactionOverlayRow | undefined
    if (!overlay) return (selectLog.all([chatId]) as StoredMessageRow[]).map((row) => row.id)
    const tail = selectRowsAfterSeq.all([chatId, overlay.covers_to_seq]) as StoredMessageRow[]
    return [overlay.id, ...tail.map((row) => row.id)]
  }

  function assertExpectedContext(chatId: string, expectedActiveIds?: string[]): void {
    if (!expectedActiveIds) return
    const currentIds = currentContextIds(chatId)
    const matches =
      currentIds.length === expectedActiveIds.length &&
      currentIds.every((id, index) => id === expectedActiveIds[index])
    if (!matches) {
      throw new TanzoOperationError(
        'CHAT_COMPACTION_STALE',
        `Conversation "${chatId}" changed while compaction was running.`,
        { recoverable: true, details: { chatId, expectedActiveIds, currentIds } }
      )
    }
  }

  function coverageFor(chatId: string, archivedIds: string[]): { from: number; to: number } | null {
    const ids = [...new Set(archivedIds)]
    if (ids.length === 0) return null
    const seqRows = selectMessageSeqs.all([chatId, JSON.stringify(ids)]) as Array<IdRow & SeqRow>
    const ranges = seqRows.map((row) => ({ from: row.seq, to: row.seq }))
    for (const id of ids) {
      const overlay = selectOverlayById.get([chatId, id]) as CompactionOverlayRow | undefined
      if (overlay) ranges.push({ from: overlay.covers_from_seq, to: overlay.covers_to_seq })
    }
    if (ranges.length === 0) return null
    return {
      from: Math.min(...ranges.map((range) => range.from)),
      to: Math.max(...ranges.map((range) => range.to))
    }
  }

  return {
    deleteAll(chatId) {
      deleteMessages.run([chatId])
      chatMirror.delete(chatId)
    },
    copyOverlaysForFork(sourceChatId, targetChatId) {
      const overlays = selectOverlays.all([sourceChatId]) as CompactionOverlayRow[]
      if (overlays.length === 0) return
      const sourceRows = selectIdSeqs.all([sourceChatId]) as Array<IdRow & SeqRow>
      const targetSeqById = new Map(
        (selectIdSeqs.all([targetChatId]) as Array<IdRow & SeqRow>).map((row) => [row.id, row.seq])
      )
      // Sort by generation so copied overlays keep their relative order.
      const byGeneration = [...overlays].sort((a, b) => a.generation - b.generation)
      let generation = 0
      for (const overlay of byGeneration) {
        const covered = sourceRows.filter(
          (row) => row.seq >= overlay.covers_from_seq && row.seq <= overlay.covers_to_seq
        )
        if (covered.length === 0) continue
        // The fork copies a prefix of the source log. An overlay whose covered
        // rows are not all present (fork point inside the covered region)
        // cannot be represented — skip it.
        const targetSeqs = covered.map((row) => targetSeqById.get(row.id))
        if (targetSeqs.some((seq) => seq === undefined)) continue
        generation += 1
        insertOverlay.run({
          conversation_id: targetChatId,
          id: overlay.id,
          generation,
          covers_from_seq: Math.min(...(targetSeqs as number[])),
          covers_to_seq: Math.max(...(targetSeqs as number[])),
          summary_text: overlay.summary_text,
          usage_json: overlay.usage_json,
          created_at: overlay.created_at
        })
      }
    },
    writeActive(chatId, messages) {
      // Hydrate the mirror before entering the write transaction so the
      // transaction body only performs writes (the read-only SELECT stays
      // outside the write-lock window).
      const mirror = getOrHydrateMirror(chatId)
      try {
        db.transaction(() => {
          const next = validLogMessages(messages)
          const seen = new Set<string>()
          for (const message of next) {
            if (seen.has(message.id)) throw new Error(`Duplicate message id "${message.id}".`)
            seen.add(message.id)
            const json = encodeMessage(message)
            const stored = mirror.messages.get(message.id)
            if (stored !== undefined) {
              // Already persisted — only write a revision when content changed.
              if (stored === json) continue
              recordRevision(chatId, message, json)
              mirror.messages.set(message.id, json)
            } else {
              // New message — insert row then record initial revision.
              insertMessage.run(messageParams(chatId, message, mirror.nextSeq))
              recordRevision(chatId, message, json)
              mirror.messages.set(message.id, json)
              mirror.nextSeq += 1
            }
          }
        })
      } catch (error) {
        // The transaction was rolled back; mirror may be partially stale.
        // Discard it so the next call re-hydrates from the actual DB state.
        chatMirror.delete(chatId)
        throw error
      }
    },
    finalizeCompaction(chatId, archivedIds, summaryId, next, expectedActiveIds) {
      db.transaction(() => {
        assertExpectedContext(chatId, expectedActiveIds)
        const coverage = coverageFor(chatId, archivedIds)
        if (!coverage) return
        const summary = next.find((message) => message.id === summaryId)
        const data = summary ? compactionData(summary) : null
        const maxGeneration = selectMaxGeneration.get([chatId]) as GenerationRow
        insertOverlay.run({
          conversation_id: chatId,
          id: summaryId,
          generation: maxGeneration.generation + 1,
          covers_from_seq: coverage.from,
          covers_to_seq: coverage.to,
          summary_text:
            data?.summary ?? summary?.parts.find((part) => part.type === 'text')?.text ?? '',
          usage_json: data?.usage ? JSON.stringify(data.usage) : null,
          created_at: Date.now()
        })

        // Renumber the whole active tail into a fresh seq block above the
        // current max, in `next` order. This keeps retained messages ordered
        // after the summary even when compaction synthesizes a new tail
        // fragment from a mid-message split (which would otherwise be inserted
        // at the very end). The fresh block is disjoint from every existing
        // seq, so moving rows cannot collide with the unique (chat, seq) index.
        const existing = new Set(
          (selectLog.all([chatId]) as StoredMessageRow[]).map((row) => row.id)
        )
        let nextSeq = ((selectMaxSeq.get([chatId]) as SeqRow).seq ?? -1) + 1
        for (const message of validLogMessages(next)) {
          if (existing.has(message.id)) {
            updateMessageSeq.run({ conversation_id: chatId, id: message.id, seq: nextSeq })
          } else {
            const json = encodeMessage(message)
            insertMessage.run(messageParams(chatId, message, nextSeq))
            recordRevision(chatId, message, json)
          }
          nextSeq += 1
        }
      })
      // Compaction renumbers seqs and may insert new messages — discard the
      // mirror so the next writeActive call re-hydrates from the current DB state.
      chatMirror.delete(chatId)
    },
    async load(chatId) {
      const overlay = selectLatestOverlay.get([chatId]) as CompactionOverlayRow | undefined
      if (!overlay) {
        const rows = selectLog.all([chatId]) as StoredMessageRow[]
        return rows.length > 0 ? validateRows(chatId, rows) : []
      }
      const tailRows = selectRowsAfterSeq.all([chatId, overlay.covers_to_seq]) as StoredMessageRow[]
      const tail = tailRows.length > 0 ? await validateRows(chatId, tailRows) : []
      return [summaryMessageFromOverlay(overlay), ...tail]
    },
    loadUnvalidated(chatId) {
      const rows = selectLog.all([chatId]) as StoredMessageRow[]
      return rows.map((row) => decodeMessage(row.message_json) as TanzoUIMessage)
    },
    async loadArchived(chatId, summaryId) {
      const overlay = selectOverlayById.get([chatId, summaryId]) as CompactionOverlayRow | undefined
      if (!overlay) return []
      const rows = selectRowsInSeqRange.all([
        chatId,
        overlay.covers_from_seq,
        overlay.covers_to_seq
      ]) as StoredMessageRow[]
      return rows.length > 0 ? validateRows(chatId, rows) : []
    },
    async loadFullHistory(chatId) {
      const rows = selectLog.all([chatId]) as StoredMessageRow[]
      return rows.length > 0 ? validateRows(chatId, rows) : []
    },
    async loadDisplay(chatId) {
      const rows = selectLog.all([chatId]) as StoredMessageRow[]
      if (rows.length === 0) return []
      const messages = await validateRows(chatId, rows)
      const byId = new Map(messages.map((message) => [message.id, message]))
      const overlays = selectOverlays.all([chatId]) as CompactionOverlayRow[]
      const overlaysByCoveredSeq = new Map<number, CompactionOverlayRow[]>()
      for (const overlay of overlays) {
        const existing = overlaysByCoveredSeq.get(overlay.covers_to_seq) ?? []
        existing.push(overlay)
        overlaysByCoveredSeq.set(overlay.covers_to_seq, existing)
      }

      const display: TanzoUIMessage[] = []
      for (const row of rows) {
        const message = byId.get(row.id)
        if (message) display.push(message)
        for (const overlay of overlaysByCoveredSeq.get(row.seq) ?? []) {
          display.push(summaryMessageFromOverlay(overlay))
        }
      }
      return display
    }
  }
}
