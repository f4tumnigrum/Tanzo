import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'

/**
 * Token ledger (v2). Replaces the anchor+full-estimate budget.
 *
 * Measurement rule:
 * - The transcript itself carries the authoritative anchors: every assistant
 *   message persists its per-step usage (`metadata.steps[].usage.inputTokens`),
 *   which is the exact prompt size the provider reported when that step ran.
 * - An anchor is only valid if no compaction summary appears AFTER it was
 *   produced — inserting a summary changes the prompt prefix, so every anchor
 *   before the latest summary is stale. Hence: use the newest reported anchor
 *   that appears AFTER the latest summary message.
 * - Everything after the anchor is estimated incrementally (bounded error),
 *   never the whole transcript.
 *
 * This is a pure module: no per-chat mutable state, restart-safe.
 */

export interface TranscriptMeasure {
  totalTokens: number
  source: 'reported' | 'estimated'
}

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/g

/** CJK-aware character heuristic: ~4 chars/token latin, ~1.5 chars/token CJK. */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  const cjk = text.match(CJK_RE)?.length ?? 0
  const latin = text.length - cjk
  return Math.ceil(latin / 4 + cjk / 1.5)
}

function estimatePartTokens(part: unknown): number {
  if (typeof part !== 'object' || part === null) return 0
  const record = part as { type?: string; text?: unknown }
  if (typeof record.text === 'string') return estimateTextTokens(record.text)
  try {
    return estimateTextTokens(JSON.stringify(part))
  } catch {
    return 16
  }
}

export function estimateUIMessageTokens(message: TanzoUIMessage): number {
  let tokens = 0
  for (const part of message.parts) {
    const type = (part as { type?: string }).type
    // Data parts never reach the model; step-start is markup.
    if (type === 'step-start' || type?.startsWith('data-')) continue
    tokens += estimatePartTokens(part)
  }
  return tokens
}

export function estimateModelMessageTokens(message: ModelMessage): number {
  const content = message.content
  if (typeof content === 'string') return estimateTextTokens(content)
  if (!Array.isArray(content)) return 0
  let tokens = 0
  for (const part of content) tokens += estimatePartTokens(part)
  return tokens
}

export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  let total = 0
  for (const message of messages) total += estimateModelMessageTokens(message)
  return total
}

export function isSummaryUIMessage(message: TanzoUIMessage): boolean {
  return message.parts.some((part) => part.type === 'data-compaction')
}

interface AnchorInfo {
  index: number
  inputTokens: number
  outputTokens: number
}

function reportedAnchor(messages: TanzoUIMessage[], afterIndex: number): AnchorInfo | null {
  for (let i = messages.length - 1; i > afterIndex; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    const steps = message.metadata?.steps
    if (!steps || steps.length === 0) continue
    const last = steps[steps.length - 1]
    const inputTokens = last?.usage?.inputTokens
    if (typeof inputTokens !== 'number' || inputTokens <= 0) continue
    // The anchor input is the prompt of the LAST step in this row, which
    // already contains every earlier step's output — so the only increment the
    // row itself adds is the last step's own output. With per-step rows
    // (design §4.5) each row carries exactly one step, making this exact.
    const outputTokens = last?.usage?.outputTokens ?? 0
    return { index: i, inputTokens, outputTokens }
  }
  return null
}

function latestSummaryIndex(messages: TanzoUIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isSummaryUIMessage(messages[i])) return i
  }
  return -1
}

/**
 * Measure the effective prompt size of a persisted transcript.
 *
 * `anchor.inputTokens` covers everything before the anchor's last step; the
 * anchor's own output plus every later message is added as an increment
 * (reported when available in metadata, estimated otherwise).
 */
export function measureTranscript(messages: TanzoUIMessage[]): TranscriptMeasure {
  const summaryIdx = latestSummaryIndex(messages)
  const anchor = reportedAnchor(messages, summaryIdx)

  if (!anchor) {
    let total = 0
    for (const message of messages) total += estimateUIMessageTokens(message)
    return { totalTokens: total, source: 'estimated' }
  }

  let total = anchor.inputTokens + anchor.outputTokens
  for (let i = anchor.index + 1; i < messages.length; i += 1) {
    total += estimateUIMessageTokens(messages[i])
  }
  return { totalTokens: total, source: 'reported' }
}
