import { useMemo } from 'react'
import { useProviderOptionSchemas } from '@/features/providers/model/queries'
import type { LanguageModelOption } from './use-available-models'
import {
  DEFAULT_REASONING_EFFORT,
  reasoningEffortCycle,
  reasoningEffortField
} from './reasoning-effort'

export interface ReasoningEffortControl {
  /**
   * The badge's current step: the conversation override, or 'default' when
   * unset. Always a member of `options`, so the cycle positions correctly.
   * Provider defaults do not appear here — the badge reflects only the
   * conversation's own choice.
   */
  effort: string
  /** Cycle options (schema-driven); null hides the control. */
  options: string[] | null
}

const HIDDEN: ReasoningEffortControl = { effort: DEFAULT_REASONING_EFFORT, options: null }

export function useReasoningEffortControl(
  model: LanguageModelOption | undefined,
  override: string | null | undefined
): ReasoningEffortControl {
  const schemasQuery = useProviderOptionSchemas(model?.providerId ?? null, 'language')
  const field = useMemo(() => reasoningEffortField(schemasQuery.data), [schemasQuery.data])
  if (!model || !field || model.capabilities?.reasoning === false) return HIDDEN
  const options = reasoningEffortCycle(field)
  const trimmed = override?.trim()
  // A stale override outside this provider's choices falls back to 'default'.
  const effort = trimmed && options.includes(trimmed) ? trimmed : DEFAULT_REASONING_EFFORT
  return { effort, options }
}
