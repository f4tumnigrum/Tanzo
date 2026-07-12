import { pruneMessages, type ModelMessage } from 'ai'
import { estimateModelMessagesTokens } from '../ledger'

export interface DegradeResult {
  messages: ModelMessage[]
  level: 'prune' | 'drop-oldest'
}

const PRUNE_KEEP_LAST = 8

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

  const keepHead = pruned[0]?.role === 'assistant' ? 1 : 0
  const head = pruned.slice(0, keepHead)
  let tail = stripLeadingTool(pruned.slice(keepHead))
  while (tail.length > 1 && estimateModelMessagesTokens([...head, ...tail]) > hardCeilingTokens) {
    tail = stripLeadingTool(tail.slice(1))
  }
  const degraded = [...head, ...tail]
  if (estimateModelMessagesTokens(degraded) > hardCeilingTokens) return null
  return { messages: degraded, level: 'drop-oldest' }
}
