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
    return details.noCacheTokens + (details.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
  }
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}
