import { useMemo } from 'react'
import type { ProviderDefaultsState, ProviderReasoningCapability } from '@/common/contracts'
import { resolveReasoningControl } from '@shared/reasoning'
import { useProviderReasoning } from '@/features/providers/model/queries'
import type { LanguageModelOption } from './use-available-models'

export interface ReasoningEffortControl {
  effort: string

  options: string[] | null
}

function providerDefaultEffort(
  capability: ProviderReasoningCapability | undefined,
  defaults: ProviderDefaultsState | undefined
): string | null {
  const effort = capability?.effort
  if (!effort || !defaults) return null
  const sources = [defaults.providerOptions, defaults.rawProviderOptions]
  for (const source of sources) {
    const scoped = source?.[effort.providerKey]
    const base = scoped && typeof scoped === 'object' ? (scoped as Record<string, unknown>) : source
    let cursor: unknown = base
    for (const segment of effort.path.split('.')) {
      if (!cursor || typeof cursor !== 'object') {
        cursor = undefined
        break
      }
      cursor = (cursor as Record<string, unknown>)[segment]
    }
    if (typeof cursor === 'string' && cursor.length > 0) return cursor
  }
  return null
}

export function useReasoningEffortControl(
  model: LanguageModelOption | undefined,
  override: string | null | undefined
): ReasoningEffortControl {
  const reasoningQuery = useProviderReasoning(model?.providerId ?? null, 'language')
  const capability = reasoningQuery.data

  return useMemo(() => {
    const control = resolveReasoningControl({
      capability,
      modelReasoningCapable: model?.capabilities?.reasoning,
      providerDefault: providerDefaultEffort(capability, model?.providerDefaults),
      override
    })
    return {
      effort: control.current,
      options: control.visible ? control.options : null
    }
  }, [capability, model?.capabilities?.reasoning, model?.providerDefaults, override])
}
