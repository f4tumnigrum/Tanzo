import { pruneMessages, type ModelMessage } from 'ai'
import { estimateModelMessagesTokens } from '../ledger'

/**
 * Mechanical emergency degradation (L3/L4). No model calls — guaranteed to
 * converge. Only ever applied at a compaction event point (the cache prefix is
 * already invalidated there), never as incremental trimming.
 *
 * L3 (`prune`): strip tool call/result content from everything except the most
 * recent messages, and drop reasoning.
 * L4 (`drop-oldest`): drop the oldest messages (keeping the leading summary
 * message when present) until the transcript fits the hard ceiling.
 */

export interface DegradeResult {
  messages: ModelMessage[]
  level: 'prune' | 'drop-oldest'
}

const PRUNE_KEEP_LAST = 8

/** A tool message cannot open a transcript — drop leading orphans. */
function stripLeadingTool(messages: ModelMessage[]): ModelMessage[] {
  let start = 0
  while (start < messages.length - 1 && messages[start].role === 'tool') start += 1
  return start > 0 ? messages.slice(start) : messages
}

export function degradeTranscript(
  messages: ModelMessage[],
  hardCeilingTokens: number
): DegradeResult | null {
  if (estimateModelMessagesTokens(messages) <= hardCeilingTokens) return null

  // L3 — prune tool payloads and reasoning outside the recent window. Pruning
  // can remove an emptied assistant while keeping its tool block; strip any
  // leading orphan so the transcript never opens with a tool message.
  const pruned = stripLeadingTool(
    pruneMessages({
      messages,
      reasoning: 'before-last-message',
      toolCalls: `before-last-${PRUNE_KEEP_LAST}-messages`,
      emptyMessages: 'remove'
    })
  )
  if (estimateModelMessagesTokens(pruned) <= hardCeilingTokens) {
    return { messages: pruned, level: 'prune' }
  }

  // L4 — drop the oldest messages. Keep index 0 when it is the compaction
  // summary (an assistant message at the head of the transcript).
  const keepHead = pruned[0]?.role === 'assistant' ? 1 : 0
  const head = pruned.slice(0, keepHead)
  let tail = stripLeadingTool(pruned.slice(keepHead))
  while (tail.length > 1 && estimateModelMessagesTokens([...head, ...tail]) > hardCeilingTokens) {
    tail = stripLeadingTool(tail.slice(1))
  }
  return { messages: [...head, ...tail], level: 'drop-oldest' }
}
