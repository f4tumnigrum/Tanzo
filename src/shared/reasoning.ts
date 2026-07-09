import type { ProviderReasoningCapability } from './provider'

export type ReasoningSource = 'override' | 'provider-default' | 'capability-default'

export interface ReasoningControl {
  visible: boolean
  options: string[]
  current: string
  source: ReasoningSource
}

export interface ResolveReasoningInput {
  capability: ProviderReasoningCapability | null | undefined
  modelReasoningCapable?: boolean
  providerDefault?: string | null
  override?: string | null
}

const HIDDEN: ReasoningControl = {
  visible: false,
  options: [],
  current: '',
  source: 'capability-default'
}

function pick(value: string | null | undefined, options: string[]): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'default') return null
  return options.includes(trimmed) ? trimmed : null
}

export function resolveReasoningControl(input: ResolveReasoningInput): ReasoningControl {
  const effort = input.capability?.effort
  if (!effort || effort.values.length === 0 || input.modelReasoningCapable !== true) {
    return HIDDEN
  }
  const options = effort.values
  const overrideValue = pick(input.override, options)
  if (overrideValue) {
    return { visible: true, options, current: overrideValue, source: 'override' }
  }
  const providerValue = pick(input.providerDefault, options)
  if (providerValue) {
    return { visible: true, options, current: providerValue, source: 'provider-default' }
  }
  const fallback = options.includes(effort.default) ? effort.default : options[0]
  return { visible: true, options, current: fallback, source: 'capability-default' }
}

export function reasoningEffortOverlayValue(
  capability: ProviderReasoningCapability | null | undefined,
  effort: string
): { providerKey: string; value: Record<string, unknown> } | null {
  const field = capability?.effort
  if (!field) return null
  const trimmed = effort.trim()
  if (!trimmed || trimmed === 'default' || !field.values.includes(trimmed)) return null
  const segments = field.path.split('.')
  let value: unknown = trimmed
  for (let i = segments.length - 1; i >= 0; i -= 1) value = { [segments[i]]: value }
  return { providerKey: field.providerKey, value: value as Record<string, unknown> }
}
