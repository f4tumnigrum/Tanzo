import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import { estimateModelMessageTokens, estimateTextTokens, isSummaryUIMessage } from '../ledger'

type Part = TanzoUIMessage['parts'][number]

/**
 * Token-aware, model-domain cut (v2). Replaces the step-count based
 * `segments.ts`.
 *
 * Boundaries:
 * - `round`: a user message and everything up to the next user message.
 * - `step group`: within an assistant message, a `step-start`-delimited slice —
 *   tool calls and their results live in the same UI part, so a step boundary
 *   can never orphan a tool pair.
 *
 * The cut retains a token budget from the tail. Preferred cut points are round
 * boundaries; when the trailing round alone exceeds the budget the cut degrades
 * to a step-group boundary inside it (splitting the assistant message into an
 * archived head fragment and a fresh-id tail fragment, as the persistence
 * overlay covers whole rows only).
 *
 * The scan never crosses the latest compaction summary: the summary itself may
 * be archived (rolling summarization — `coverageFor` merges its covered range),
 * but nothing before it can be re-archived.
 */

export interface Cut {
  messageIndex: number
  partIndex: number
}

export interface Partition {
  head: TanzoUIMessage[]
  tail: TanzoUIMessage[]
  archivedIds: string[]
}

interface Unit {
  messageIndex: number
  partStart: number
  partEnd: number
  tokens: number
  isRoundStart: boolean
  isSummary: boolean
}

function partTokens(part: Part): number {
  const type = (part as { type?: string }).type
  if (type === 'step-start') return 0
  const text = (part as { text?: unknown }).text
  if (typeof text === 'string') return estimateTextTokens(text)
  try {
    return estimateTextTokens(JSON.stringify(part))
  } catch {
    return 16
  }
}

function sliceTokens(parts: Part[], start: number, end: number): number {
  let tokens = 0
  for (let i = start; i < end; i += 1) tokens += partTokens(parts[i])
  return tokens
}

function stepBoundaries(parts: Part[]): number[] {
  const bounds = [0]
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].type === 'step-start') bounds.push(i)
  }
  return bounds
}

export function buildUnits(messages: TanzoUIMessage[]): Unit[] {
  const units: Unit[] = []
  messages.forEach((message, messageIndex) => {
    const isSummary = isSummaryUIMessage(message)
    if (message.role !== 'assistant') {
      units.push({
        messageIndex,
        partStart: 0,
        partEnd: message.parts.length,
        tokens: sliceTokens(message.parts, 0, message.parts.length),
        isRoundStart: message.role === 'user',
        isSummary
      })
      return
    }
    const bounds = stepBoundaries(message.parts)
    bounds.forEach((partStart, k) => {
      const partEnd = bounds[k + 1] ?? message.parts.length
      units.push({
        messageIndex,
        partStart,
        partEnd,
        tokens: sliceTokens(message.parts, partStart, partEnd),
        isRoundStart: false,
        isSummary
      })
    })
  })
  return units
}

/**
 * Returns the cut point, or null when there is nothing worth archiving
 * (transcript already fits the retain budget, or only a summary would move).
 */
export function findCut(messages: TanzoUIMessage[], retainBudgetTokens: number): Cut | null {
  const units = buildUnits(messages)
  if (units.length === 0) return null

  // Units at or before the latest summary are off-limits for retention scan —
  // the cut may include the summary itself in the head (rolling), never less.
  let summaryLimit = -1
  for (let i = units.length - 1; i >= 0; i -= 1) {
    if (units[i].isSummary) {
      summaryLimit = i
      break
    }
  }

  const suffixTokens: number[] = new Array(units.length + 1)
  suffixTokens[units.length] = 0
  for (let i = units.length - 1; i >= 0; i -= 1) {
    suffixTokens[i] = suffixTokens[i + 1] + units[i].tokens
  }

  // Whole transcript (after the summary) already within budget → nothing to do.
  if (suffixTokens[summaryLimit + 1] <= retainBudgetTokens) return null

  // Preferred: the earliest round boundary whose suffix fits the budget.
  let cutUnit = -1
  for (let i = summaryLimit + 1; i < units.length; i += 1) {
    if (!units[i].isRoundStart) continue
    if (suffixTokens[i] <= retainBudgetTokens) {
      cutUnit = i
      break
    }
  }

  if (cutUnit === -1) {
    // Degrade: step-group boundary. Keep at least the final unit.
    cutUnit = units.length - 1
    for (let i = units.length - 2; i > summaryLimit; i -= 1) {
      if (suffixTokens[i] > retainBudgetTokens) break
      cutUnit = i
    }
  }

  const unit = units[cutUnit]
  if (unit.messageIndex === 0 && unit.partStart === 0) return null
  // Honor the contract: a head that would archive nothing but summaries is
  // not worth a cut (rolling a summary alone re-summarizes nothing new).
  const headOnlySummaries = units.slice(0, cutUnit).every((u) => u.isSummary)
  if (headOnlySummaries) return null
  return { messageIndex: unit.messageIndex, partIndex: unit.partStart }
}

function normalizeTailParts(parts: Part[]): Part[] {
  const head: Part = parts[0]?.type === 'step-start' ? parts[0] : { type: 'step-start' }
  const rest = parts[0]?.type === 'step-start' ? parts.slice(1) : parts
  let i = 0
  while (i < rest.length && rest[i].type === 'reasoning') i += 1
  return [head, ...rest.slice(i)]
}

export function partitionAtCut(messages: TanzoUIMessage[], cut: Cut): Partition {
  if (cut.partIndex === 0) {
    const head = messages.slice(0, cut.messageIndex)
    return {
      head,
      tail: messages.slice(cut.messageIndex),
      archivedIds: head.map((m) => m.id)
    }
  }
  const splitMessage = messages[cut.messageIndex]
  const headFragment: TanzoUIMessage = {
    ...splitMessage,
    parts: splitMessage.parts.slice(0, cut.partIndex)
  }
  const tailFragment: TanzoUIMessage = {
    id: randomUUID(),
    role: splitMessage.role,
    parts: normalizeTailParts(splitMessage.parts.slice(cut.partIndex))
  }
  const before = messages.slice(0, cut.messageIndex)
  return {
    head: [...before, headFragment],
    tail: [tailFragment, ...messages.slice(cut.messageIndex + 1)],
    archivedIds: [...before.map((m) => m.id), splitMessage.id]
  }
}

export function splitForCompaction(
  messages: TanzoUIMessage[],
  retainBudgetTokens: number
): Partition | null {
  const cut = findCut(messages, retainBudgetTokens)
  if (!cut) return null
  return partitionAtCut(messages, cut)
}

// ---------------------------------------------------------------------------
// Model-domain cut (in-stream compaction)
// ---------------------------------------------------------------------------

export interface ModelPartition {
  head: ModelMessage[]
  tail: ModelMessage[]
}

interface ModelUnit {
  start: number
  end: number
  tokens: number
  isRoundStart: boolean
}

/**
 * Group a live model transcript into closed units: a user message opens a
 * round; an assistant message plus its following tool messages form a step
 * group (tool call/result pairs can never be split apart).
 */
function buildModelUnits(messages: ModelMessage[]): ModelUnit[] {
  const units: ModelUnit[] = []
  let i = 0
  while (i < messages.length) {
    const message = messages[i]
    let end = i + 1
    if (message.role === 'assistant') {
      while (end < messages.length && messages[end].role === 'tool') end += 1
    }
    let tokens = 0
    for (let k = i; k < end; k += 1) tokens += estimateModelMessageTokens(messages[k])
    units.push({ start: i, end, tokens, isRoundStart: message.role === 'user' })
    i = end
  }
  return units
}

/**
 * Cut a live model transcript so the tail fits the retain budget. Prefers
 * round boundaries, degrades to step-group boundaries. Returns null when the
 * transcript already fits or nothing archivable remains.
 *
 * The scan never crosses the leading compaction summary (an assistant message
 * at index 0 — the canonical `[summary, ...tail]` shape): it may be included
 * in the head (rolling summarization) but nothing before it exists anyway.
 */
export function splitModelTranscript(
  messages: ModelMessage[],
  retainBudgetTokens: number
): ModelPartition | null {
  const units = buildModelUnits(messages)
  if (units.length <= 1) return null

  const suffixTokens: number[] = new Array(units.length + 1)
  suffixTokens[units.length] = 0
  for (let i = units.length - 1; i >= 0; i -= 1) {
    suffixTokens[i] = suffixTokens[i + 1] + units[i].tokens
  }
  if (suffixTokens[0] <= retainBudgetTokens) return null

  let cutUnit = -1
  for (let i = 1; i < units.length; i += 1) {
    if (!units[i].isRoundStart) continue
    if (suffixTokens[i] <= retainBudgetTokens) {
      cutUnit = i
      break
    }
  }
  if (cutUnit === -1) {
    cutUnit = units.length - 1
    for (let i = units.length - 2; i >= 1; i -= 1) {
      if (suffixTokens[i] > retainBudgetTokens) break
      cutUnit = i
    }
  }
  if (cutUnit <= 0) return null

  const boundary = units[cutUnit].start
  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) }
}
