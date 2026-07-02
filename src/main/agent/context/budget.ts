import type { LanguageModelUsage, ModelMessage } from 'ai'

export interface Anchor {
  messageCount: number
  inputTokens: number
}

export interface ContextUsage {
  inputTokens?: number
  source: 'reported' | 'unavailable' | 'estimated'
  exceeds(tokenCount: number): boolean
}

/**
 * Rough character-to-token heuristic (4 chars ≈ 1 token) applied to the full
 * message array. Used as a conservative fallback when no provider-reported
 * anchor is available — e.g. right after compaction clears the anchor, or
 * when a provider does not report usage. The estimate intentionally over-counts
 * (structured parts are counted by their JSON length) so it fails safe toward
 * triggering compaction rather than missing it.
 */
function estimateTokensFromMessages(messages: ModelMessage[]): number {
  let chars = 0
  for (const msg of messages) {
    const content = msg.content
    if (typeof content === 'string') {
      chars += content.length
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'object' && part !== null) {
          if ('text' in part && typeof part.text === 'string') {
            chars += part.text.length
          } else {
            // Structured parts (tool calls, images, etc.) – use JSON length as proxy.
            try {
              chars += JSON.stringify(part).length
            } catch {
              chars += 64 // conservative minimum per opaque part
            }
          }
        }
      }
    }
  }
  return Math.ceil(chars / 4)
}

export function createBudget() {
  const anchors = new Map<string, Anchor>()

  function anchor(chatId: string, messageCount: number, inputTokens: number): void {
    if (inputTokens > 0) anchors.set(chatId, { messageCount, inputTokens })
  }

  function reportedInput(chatId: string): { tokens?: number; source: 'reported' | 'unavailable' } {
    const a = anchors.get(chatId)
    return a ? { tokens: a.inputTokens, source: 'reported' } : { source: 'unavailable' }
  }

  /**
   * Measure the effective context size for `chatId` given the current
   * `messages`. Strategy:
   *
   *  1. If a provider-reported anchor exists, use it as the authoritative
   *     floor — it reflects actual tokenisation by the model.
   *  2. Compute a char-based estimate from `messages` as a fallback / safety
   *     net. This fires when:
   *     - No anchor yet (first turn, or just after compaction cleared it).
   *     - The anchor is stale because the conversation grew substantially since
   *       the last reported turn (e.g. a large user paste between turns).
   *  3. Return the maximum of anchor and estimate so neither path can mask an
   *     over-limit condition.
   */
  function measureUsage(chatId: string, messages: ModelMessage[]): ContextUsage {
    const { tokens: anchorTokens, source } = reportedInput(chatId)
    const estimate = estimateTokensFromMessages(messages)

    if (anchorTokens !== undefined) {
      // Use max so a large paste between turns isn't hidden by a stale anchor.
      const effective = Math.max(anchorTokens, estimate)
      return {
        inputTokens: effective,
        source: effective > anchorTokens ? 'estimated' : source,
        exceeds: (tokenCount: number) => effective > tokenCount
      }
    }

    // No anchor at all (post-compaction or first turn).
    return {
      inputTokens: estimate,
      source: 'estimated',
      exceeds: (tokenCount: number) => estimate > tokenCount
    }
  }

  function clear(chatId: string): void {
    anchors.delete(chatId)
  }

  return { anchor, reportedInput, measureUsage, clear }
}

export type Budget = ReturnType<typeof createBudget>

export function cacheHitRatio(usage: LanguageModelUsage | undefined): number | undefined {
  const input = usage?.inputTokens
  const cached = usage?.inputTokenDetails?.cacheReadTokens
  if (input == null || input <= 0 || cached == null) return undefined
  return cached / input
}
