import type { ModelCapabilities } from '../capabilities'

export interface CompactionPolicy {
  /** Reported prompt tokens above this trigger compaction. */
  compactionTriggerTokens: number
  /** Token budget for the retained tail when cutting the transcript. */
  retainBudgetTokens: number
  /** Absolute prompt ceiling (window − maxOutput); emergency degradation applies above it. */
  hardCeilingTokens: number
}

const TRIGGER_FRACTION = 0.8
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
