import { randomUUID } from 'node:crypto'
import { convertToModelMessages, type ModelMessage } from 'ai'
import type { TanzoDataParts, TanzoUIMessage, TanzoUsageMetadata } from '@shared/agent-message'
import { canonicalizeToolTranscript } from '../tool-transcript'
import { resolvePastedTextPointers } from '../../runtime/pasted-text'
import { isSummaryUIMessage } from '../ledger'
import { splitForCompaction, type Partition } from './cut'
import { stripAnalysis } from './prompt'

export { splitForCompaction }
export type { Partition }

export interface CompactionPlan {
  head: TanzoUIMessage[]
  tail: TanzoUIMessage[]
  archivedIds: string[]
  sourceMessages: ModelMessage[]
}

export interface CompactionResult {
  summary: TanzoUIMessage
  archivedIds: string[]
  beforeTokens?: number
  afterTokens?: number
  next: TanzoUIMessage[]
}

export async function planCompaction(
  messages: TanzoUIMessage[],
  retainBudgetTokens: number
): Promise<CompactionPlan | null> {
  const partition = splitForCompaction(messages, retainBudgetTokens)
  if (!partition) return null
  const { head, tail, archivedIds } = partition
  if (head.length === 0) return null
  if (head.every(isSummaryUIMessage)) return null

  const sourceMessages = canonicalizeToolTranscript(
    await convertToModelMessages(resolvePastedTextPointers(head), {
      ignoreIncompleteToolCalls: true
    })
  )
  if (sourceMessages.length === 0) return null

  return { head, tail, archivedIds, sourceMessages }
}

export function buildSummaryMessage(input: {
  summaryText: string
  summaryId?: string
  auto: boolean
  beforeTokens?: number
  afterTokens?: number
  usage?: TanzoUsageMetadata
  omittedMessages: number
  degraded?: TanzoDataParts['compaction']['degraded']
}): TanzoUIMessage {
  const reducedTokens =
    input.beforeTokens !== undefined && input.afterTokens !== undefined
      ? Math.max(input.beforeTokens - input.afterTokens, 0)
      : undefined
  const summaryId = input.summaryId ?? randomUUID()
  const compaction: TanzoDataParts['compaction'] = {
    stage: 'complete',
    auto: input.auto,
    summary: input.summaryText,
    summaryId,
    ...(input.beforeTokens !== undefined ? { beforeTokens: input.beforeTokens } : {}),
    ...(input.afterTokens !== undefined ? { afterTokens: input.afterTokens } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    ...(reducedTokens !== undefined ? { reducedTokens } : {}),
    ...(input.degraded ? { degraded: input.degraded } : {}),
    omittedMessages: input.omittedMessages
  }
  return {
    id: summaryId,
    role: 'assistant',
    parts: [
      { type: 'text', text: input.summaryText },
      { type: 'data-compaction', data: compaction }
    ]
  }
}

export function buildCompactionResult(input: {
  plan: CompactionPlan
  summaryText: string
  summaryId?: string
  auto: boolean
  usage?: TanzoUsageMetadata
}): CompactionResult {
  const summaryText = stripAnalysis(input.summaryText)
  if (!summaryText) throw new Error('Compaction produced an empty summary')

  const { plan, usage } = input
  const beforeTokens = usage?.inputTokens
  const afterTokens = usage?.outputTokens
  const summary = buildSummaryMessage({
    summaryText,
    ...(input.summaryId ? { summaryId: input.summaryId } : {}),
    auto: input.auto,
    ...(beforeTokens !== undefined ? { beforeTokens } : {}),
    ...(afterTokens !== undefined ? { afterTokens } : {}),
    ...(usage ? { usage } : {}),
    omittedMessages: plan.head.length
  })

  return {
    summary,
    archivedIds: plan.archivedIds,
    ...(beforeTokens !== undefined ? { beforeTokens } : {}),
    ...(afterTokens !== undefined ? { afterTokens } : {}),
    next: [summary, ...plan.tail]
  }
}
