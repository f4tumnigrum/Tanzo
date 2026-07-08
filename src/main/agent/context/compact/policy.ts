import type { ModelCapabilities } from '../capabilities'

export interface CompactionPolicy {
  compactionTriggerTokens: number

  retainBudgetTokens: number

  hardCeilingTokens: number
}

const TRIGGER_FRACTION = 0.9
const RETAIN_FRACTION = 0.15
const RETAIN_MAX_TOKENS = 30_000

export function computeCompactionPolicy(cap: ModelCapabilities): CompactionPolicy {
  const inputWindowTokens = Math.max(cap.contextWindow - cap.maxOutputTokens, 0)
  return {
    compactionTriggerTokens: Math.floor(inputWindowTokens * TRIGGER_FRACTION),
    retainBudgetTokens: Math.min(
      RETAIN_MAX_TOKENS,
      Math.max(1, Math.floor(cap.contextWindow * RETAIN_FRACTION))
    ),
    hardCeilingTokens: inputWindowTokens
  }
}
