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
  projected_at: number
}

interface ChatMirrorState {
  messages: Map<string, string>

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
  data_json: string | null
  created_at: number
}

type ExpectedActiveContext = string[] | TanzoUIMessage[]

export interface MessageRepo {
  deleteAll(chatId: string): void
  writeActive(chatId: string, messages: TanzoUIMessage[]): void

  copyOverlaysForFork(sourceChatId: string, targetChatId: string): void
  finalizeCompaction(
    chatId: string,
    archivedIds: string[],
    summaryId: string,
    next: TanzoUIMessage[],
    expectedActive?: ExpectedActiveContext,
    archivedMessages?: TanzoUIMessage[]
  ): void

  load(chatId: string): Promise<TanzoUIMessage[]>

  loadUnvalidated(chatId: string): TanzoUIMessage[]

  loadArchived(chatId: string, summaryId: string): Promise<TanzoUIMessage[]>

  loadFullHistory(chatId: string): Promise<TanzoUIMessage[]>

  loadDisplay(chatId: string): Promise<TanzoUIMessage[]>
}

export function createMessageRepo(db: SqlDatabase, logger: Logger): MessageRepo {
  const deleteMessages = db.prepare('DELETE FROM messages WHERE conversation_id = ?')
  const deleteOverlays = db.prepare('DELETE FROM compaction_overlays WHERE conversation_id = ?')
  const deleteMessageById = db.prepare('DELETE FROM messages WHERE conversation_id = ? AND id = ?')
  const logProjectionSql = `
    SELECT
      m.id,
      m.seq,
      COALESCE(r.message_json, m.message_json) AS message_json,
      m.created_at,
      COALESCE(r.created_at, m.created_at) AS projected_at
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
    'SELECT id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, data_json, created_at FROM compaction_overlays WHERE conversation_id = ? ORDER BY covers_to_seq, generation'
  )
  const selectLatestOverlay = db.prepare(
    'SELECT id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, data_json, created_at FROM compaction_overlays WHERE conversation_id = ? ORDER BY generation DESC LIMIT 1'
  )
  const selectOverlayById = db.prepare(
    'SELECT id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, data_json, created_at FROM compaction_overlays WHERE conversation_id = ? AND id = ?'
  )
  const selectMaxGeneration = db.prepare(
    'SELECT COALESCE(MAX(generation), 0) AS generation FROM compaction_overlays WHERE conversation_id = ?'
  )
  const insertOverlay = db.prepare(`
    INSERT INTO compaction_overlays (
      conversation_id, id, generation, covers_from_seq, covers_to_seq, summary_text, usage_json, data_json, created_at
    ) VALUES (
      @conversation_id, @id, @generation, @covers_from_seq, @covers_to_seq, @summary_text, @usage_json, @data_json, @created_at
    )
  `)
  const selectMaxSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), -1) AS seq FROM messages WHERE conversation_id = ?'
  )
  const selectRevisionHistory = db.prepare(
    'SELECT message_json, created_at FROM message_revisions WHERE conversation_id = ? AND message_id = ? ORDER BY revision DESC'
  )
  const selectBaseMessage = db.prepare(
    'SELECT message_json, created_at FROM messages WHERE conversation_id = ? AND id = ?'
  )
  const selectIdSeqs = db.prepare(
    'SELECT id, seq FROM messages WHERE conversation_id = ? ORDER BY seq'
  )

  const chatMirror = new Map<string, ChatMirrorState>()

  const validationCache = new Map<string, TanzoUIMessage>()
  const revisionFallbackCache = new Map<string, { message: TanzoUIMessage; projectedAt: number }>()

  const fallbackCacheKey = (chatId: string, row: StoredMessageRow): string =>
    `${chatId}\u0000${row.id}\u0000${row.message_json}`

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
      deleteOverlays.run([chatId])
      deleteMessageById.run([chatId, row.id])
    })

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

  async function recoverPriorRevision(
    chatId: string,
    row: StoredMessageRow
  ): Promise<{ message: TanzoUIMessage; projectedAt: number } | null> {
    const revisions = selectRevisionHistory.all([chatId, row.id]) as Array<{
      message_json: string
      created_at: number
    }>
    const base = selectBaseMessage.get([chatId, row.id]) as
      { message_json: string; created_at: number } | undefined
    const candidates = base ? [...revisions, base] : revisions
    for (const candidate of candidates) {
      if (candidate.message_json === row.message_json) continue
      const decoded = decodeMessage(candidate.message_json)
      const message = (await validateOne(decoded)) ?? (await salvageMessage(decoded))
      if (message) return { message, projectedAt: candidate.created_at }
    }
    return null
  }

  async function validateRows(chatId: string, rows: StoredMessageRow[]): Promise<TanzoUIMessage[]> {
    const resolved = new Map<number, TanzoUIMessage>()
    const uncached: number[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const fallback = revisionFallbackCache.get(fallbackCacheKey(chatId, rows[i]))
      if (fallback) {
        rows[i].projected_at = fallback.projectedAt
        resolved.set(i, fallback.message)
        continue
      }
      const hit = validationCache.get(rows[i].message_json)
      if (hit) resolved.set(i, hit)
      else uncached.push(i)
    }

    if (uncached.length === 0) return rows.map((_, i) => resolved.get(i) as TanzoUIMessage)

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
        const fallback = await recoverPriorRevision(chatId, row)
        if (fallback) {
          logger.warn('restored previous valid message revision', { chatId, id: row.id })
          row.projected_at = fallback.projectedAt
          revisionFallbackCache.set(fallbackCacheKey(chatId, row), fallback)
          resolved.set(uncached[k], fallback.message)
        } else {
          quarantine(chatId, row, all.error)
        }
      }
    }

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
    const persisted = overlay.data_json
      ? (JSON.parse(overlay.data_json) as TanzoDataParts['compaction'])
      : undefined
    const legacyUsage = overlay.usage_json
      ? (JSON.parse(overlay.usage_json) as TanzoDataParts['compaction']['usage'])
      : undefined
    const data: TanzoDataParts['compaction'] = {
      ...(persisted ?? {}),
      stage: 'complete',
      summary: overlay.summary_text,
      summaryId: overlay.id,
      ...(!persisted?.usage && legacyUsage ? { usage: legacyUsage } : {})
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

  function withoutStaleUsageAnchor(message: TanzoUIMessage): TanzoUIMessage {
    const steps = message.metadata?.steps
    if (!steps?.some((step) => step.usage)) return message
    return {
      ...message,
      metadata: {
        ...message.metadata,
        steps: steps.map((step) => ({ ...step, usage: null }))
      }
    }
  }

  function projectedMessage(row: StoredMessageRow, overlay: CompactionOverlayRow): TanzoUIMessage {
    const message = decodeMessage(row.message_json) as TanzoUIMessage
    return row.projected_at <= overlay.created_at ? withoutStaleUsageAnchor(message) : message
  }

  function currentContextMessages(chatId: string): TanzoUIMessage[] {
    const overlay = selectLatestOverlay.get([chatId]) as CompactionOverlayRow | undefined
    if (!overlay) {
      return (selectLog.all([chatId]) as StoredMessageRow[]).map(
        (row) => decodeMessage(row.message_json) as TanzoUIMessage
      )
    }
    const tail = selectRowsAfterSeq.all([chatId, overlay.covers_to_seq]) as StoredMessageRow[]
    return [
      summaryMessageFromOverlay(overlay),
      ...tail.map((row) => projectedMessage(row, overlay))
    ]
  }

  function assertExpectedContext(chatId: string, expectedActive?: ExpectedActiveContext): void {
    if (!expectedActive) return
    const current = currentContextMessages(chatId)
    const expectsIds = expectedActive.length === 0 || typeof expectedActive[0] === 'string'
    const expectedMessages = expectsIds ? null : (expectedActive as TanzoUIMessage[])
    const expectedIds = expectsIds
      ? (expectedActive as string[])
      : (expectedActive as TanzoUIMessage[]).map((message) => message.id)
    const currentIds = current.map((message) => message.id)
    const idsMatch =
      currentIds.length === expectedIds.length &&
      currentIds.every((id, index) => id === expectedIds[index])
    const contentMatches =
      expectedMessages === null ||
      (current.length === expectedMessages.length &&
        current.every(
          (message, index) => encodeMessage(message) === encodeMessage(expectedMessages[index])
        ))
    const matches = idsMatch && contentMatches
    if (!matches) {
      throw new TanzoOperationError(
        'CHAT_COMPACTION_STALE',
        `Conversation "${chatId}" changed while compaction was running.`,
        { recoverable: true, details: { chatId, expectedIds, currentIds } }
      )
    }
  }

  function reorderActiveMessages(
    chatId: string,
    messages: TanzoUIMessage[],
    mirror: ChatMirrorState
  ): void {
    if (messages.length < 2) return
    const rows = selectIdSeqs.all([chatId]) as Array<IdRow & SeqRow>
    const seqById = new Map(rows.map((row) => [row.id, row.seq]))
    const overlay = selectLatestOverlay.get([chatId]) as CompactionOverlayRow | undefined
    const desiredIds = messages
      .map((message) => message.id)
      .filter((id) => {
        const seq = seqById.get(id)
        return seq !== undefined && (!overlay || seq > overlay.covers_to_seq)
      })
    const desiredSet = new Set(desiredIds)
    const actualIds = rows.filter((row) => desiredSet.has(row.id)).map((row) => row.id)
    if (
      actualIds.length === desiredIds.length &&
      actualIds.every((id, index) => id === desiredIds[index])
    ) {
      return
    }

    let nextSeq = ((selectMaxSeq.get([chatId]) as SeqRow).seq ?? -1) + 1
    for (const id of desiredIds) {
      updateMessageSeq.run({ conversation_id: chatId, id, seq: nextSeq })
      nextSeq += 1
    }
    mirror.nextSeq = nextSeq
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
      deleteOverlays.run([chatId])
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

      const byGeneration = [...overlays].sort((a, b) => a.generation - b.generation)
      let generation = 0
      for (const overlay of byGeneration) {
        const covered = sourceRows.filter(
          (row) => row.seq >= overlay.covers_from_seq && row.seq <= overlay.covers_to_seq
        )
        if (covered.length === 0) continue

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
          data_json: overlay.data_json,
          created_at: overlay.created_at
        })
      }
    },
    writeActive(chatId, messages) {
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
              if (stored === json) continue
              recordRevision(chatId, message, json)
              mirror.messages.set(message.id, json)
            } else {
              insertMessage.run(messageParams(chatId, message, mirror.nextSeq))
              recordRevision(chatId, message, json)
              mirror.messages.set(message.id, json)
              mirror.nextSeq += 1
            }
          }
          reorderActiveMessages(chatId, next, mirror)
        })
      } catch (error) {
        chatMirror.delete(chatId)
        throw error
      }
    },
    finalizeCompaction(chatId, archivedIds, summaryId, next, expectedActive, archivedMessages) {
      db.transaction(() => {
        assertExpectedContext(chatId, expectedActive)
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
          data_json: data ? JSON.stringify(data) : null,
          created_at: Date.now()
        })

        const existing = new Map(
          (selectLog.all([chatId]) as StoredMessageRow[]).map((row) => [row.id, row.message_json])
        )
        for (const message of archivedMessages ?? []) {
          const stored = existing.get(message.id)
          if (stored === undefined) continue
          const json = encodeMessage(message)
          if (stored === json) continue
          recordRevision(chatId, message, json)
          existing.set(message.id, json)
        }

        let nextSeq = ((selectMaxSeq.get([chatId]) as SeqRow).seq ?? -1) + 1
        for (const message of validLogMessages(next)) {
          const stored = existing.get(message.id)
          if (stored !== undefined) {
            const json = encodeMessage(message)
            if (stored !== json) {
              recordRevision(chatId, message, json)
              existing.set(message.id, json)
            }
            updateMessageSeq.run({ conversation_id: chatId, id: message.id, seq: nextSeq })
          } else {
            const json = encodeMessage(message)
            insertMessage.run(messageParams(chatId, message, nextSeq))
            recordRevision(chatId, message, json)
            existing.set(message.id, json)
          }
          nextSeq += 1
        }
      })

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
      const rowById = new Map(tailRows.map((row) => [row.id, row]))
      return [
        summaryMessageFromOverlay(overlay),
        ...tail.map((message) =>
          (rowById.get(message.id)?.projected_at ?? Number.POSITIVE_INFINITY) <= overlay.created_at
            ? withoutStaleUsageAnchor(message)
            : message
        )
      ]
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
