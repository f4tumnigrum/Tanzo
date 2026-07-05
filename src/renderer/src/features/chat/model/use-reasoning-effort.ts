import { useMemo } from 'react'
import { useProviderOptionSchemas } from '@/features/providers/model/queries'
import type { LanguageModelOption } from './use-available-models'
import {
  DEFAULT_REASONING_EFFORT,
  reasoningEffortCycle,
  reasoningEffortField,
  reasoningEffortFromDefaults
} from './reasoning-effort'

export interface ReasoningEffortControl {
  /**
   * Displayed value: conversation override when set, otherwise the value the
   * provider defaults would apply, otherwise 'default'.
   */
  effort: string
  /** Cycle options for the composer badge; null hides the control. */
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
  const fromDefaults = reasoningEffortFromDefaults(field, {
    providerOptions: model.providerDefaults.providerOptions,
    rawProviderOptions: model.providerDefaults.rawProviderOptions
  })
  return {
    effort: override?.trim() || fromDefaults || DEFAULT_REASONING_EFFORT,
    options: reasoningEffortCycle(field)
  }
}
