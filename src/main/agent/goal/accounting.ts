/**
 * Goal budget accounting (v2, invariant I3).
 *
 * Budget consumption measures *new compute*, decoupled from KV-cache hits:
 * cached prefix reads are ~0.1x priced and re-read the same tokens every step,
 * so counting them (the old `totalTokens` metric) made long-context goals
 * consume budget quadratically with conversation length. Effective tokens =
 * non-cached input + cache writes + output.
 *
 * The AI SDK v7 normalizes provider usage into
 * `inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`
 * (Anthropic cache_read/creation, OpenAI cached_tokens all map there), so this
 * is provider-agnostic. When the breakdown is unavailable (some
 * openai-compatible backends) fall back conservatively to the full input.
 */

export interface UsageForAccounting {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

export function effectiveTokens(usage: UsageForAccounting | undefined): number {
  if (!usage) return 0
  const details = usage.inputTokenDetails
  if (details?.noCacheTokens != null) {
    return (
      details.noCacheTokens + (details.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
    )
  }
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}
