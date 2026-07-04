import type { ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import { estimateModelMessageTokens, estimateUIMessageTokens, isSummaryUIMessage } from '../ledger'

/**
 * Token-aware cut (v2). Replaces the step-count based `segments.ts`.
 *
 * Persisted transcripts are per-step rows (`@shared/message-steps`): a
 * multi-step assistant reply is stored as one message per step group, so every
 * message boundary is a valid cut point and tool call/result pairs — which
 * live inside a single step group — can never be split apart.
 *
 * Boundaries:
 * - `round`: a user message and everything up to the next user message
 *   (preferred cut point);
 * - any message boundary (step-group granularity) when the trailing round
 *   alone exceeds the budget.
 *
 * The scan never crosses the latest compaction summary: the summary itself may
 * be archived (rolling summarization — `coverageFor` merges its covered range),
 * but nothing before it can be re-archived.
 */

export interface Partition {
  head: TanzoUIMessage[]
  tail: TanzoUIMessage[]
  archivedIds: string[]
}

/**
 * Returns the cut index (first retained message), or null when there is
 * nothing worth archiving (transcript already fits the retain budget, or only
 * a summary would move).
 */
export function findCut(messages: TanzoUIMessage[], retainBudgetTokens: number): number | null {
  if (messages.length === 0) return null

  // Messages at or before the latest summary are off-limits for the retention
  // scan — the cut may include the summary itself in the head (rolling),
  // never less.
  let summaryLimit = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isSummaryUIMessage(messages[i])) {
      summaryLimit = i
      break
    }
  }

  const suffixTokens: number[] = new Array(messages.length + 1)
  suffixTokens[messages.length] = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    suffixTokens[i] = suffixTokens[i + 1] + estimateUIMessageTokens(messages[i])
  }

  // Whole transcript (after the summary) already within budget → nothing to do.
  if (suffixTokens[summaryLimit + 1] <= retainBudgetTokens) return null

  // Preferred: the earliest round boundary whose suffix fits the budget.
  let cut = -1
  for (let i = summaryLimit + 1; i < messages.length; i += 1) {
    if (messages[i].role !== 'user') continue
    if (suffixTokens[i] <= retainBudgetTokens) {
      cut = i
      break
    }
  }

  if (cut === -1) {
    // Degrade: any message boundary (per-step rows make this a step-group
    // boundary). Keep at least the final message.
    cut = messages.length - 1
    for (let i = messages.length - 2; i > summaryLimit; i -= 1) {
      if (suffixTokens[i] > retainBudgetTokens) break
      cut = i
    }
  }

  if (cut <= 0) return null
  // Honor the contract: a head that would archive nothing but summaries is
  // not worth a cut (rolling a summary alone re-summarizes nothing new).
  if (messages.slice(0, cut).every(isSummaryUIMessage)) return null
  return cut
}

export function splitForCompaction(
  messages: TanzoUIMessage[],
  retainBudgetTokens: number
): Partition | null {
  const cut = findCut(messages, retainBudgetTokens)
  if (cut === null) return null
  const head = messages.slice(0, cut)
  return {
    head,
    tail: messages.slice(cut),
    archivedIds: head.map((message) => message.id)
  }
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
