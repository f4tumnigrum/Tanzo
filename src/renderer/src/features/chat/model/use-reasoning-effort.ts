import { useMemo } from 'react'
import { useProviderOptionSchemas } from '@/features/providers/model/queries'
import type { LanguageModelOption } from './use-available-models'
import { reasoningEffortCycle, reasoningEffortField } from './reasoning-effort'

export interface ReasoningEffortControl {
  effort: string

  options: string[] | null
}

const HIDDEN: ReasoningEffortControl = { effort: '', options: null }

export function useReasoningEffortControl(
  model: LanguageModelOption | undefined,
  override: string | null | undefined
): ReasoningEffortControl {
  const schemasQuery = useProviderOptionSchemas(model?.providerId ?? null, 'language')
  const field = useMemo(() => reasoningEffortField(schemasQuery.data), [schemasQuery.data])
  if (!model || !field || model.capabilities?.reasoning === false) return HIDDEN
  const options = reasoningEffortCycle(field)
  const trimmed = override?.trim()

  const effort = trimmed && options.includes(trimmed) ? trimmed : field.default
  return { effort, options }
}
