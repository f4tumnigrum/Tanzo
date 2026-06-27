import type { ProviderDefaultsState, ProviderId } from '@/common/contracts'

export type ReasoningEffort =
  | 'default'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

const ANTHROPIC_EFFORTS: ReasoningEffort[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max']
const OPENAI_LIKE_EFFORTS: ReasoningEffort[] = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
]
const GOOGLE_EFFORTS: ReasoningEffort[] = ['default', 'minimal', 'low', 'medium', 'high']
const DEEPSEEK_EFFORTS: ReasoningEffort[] = ['default']
const EFFORT_VALUES = new Set<ReasoningEffort>([
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])

export function reasoningEffortsForProvider(
  providerId: ProviderId | string,
  capabilityHint?: { reasoning?: boolean }
): ReasoningEffort[] | null {
  if (capabilityHint?.reasoning === false) return null
  switch (providerId.toLowerCase()) {
    case 'anthropic':
      return ANTHROPIC_EFFORTS
    case 'openai':
    case 'openai-compatible':
      return OPENAI_LIKE_EFFORTS
    case 'google':
      return GOOGLE_EFFORTS
    case 'deepseek':
      return DEEPSEEK_EFFORTS
    default:
      return null
  }
}

export function reasoningEffortFromDefaults(
  providerId: ProviderId | string,
  defaults: ProviderDefaultsState | undefined
): ReasoningEffort {
  const options = (defaults?.providerOptions ?? {}) as Record<string, unknown>
  switch (providerId.toLowerCase()) {
    case 'anthropic':
      return normalizeEffort(options.effort)
    case 'openai':
    case 'openai-compatible':
      return normalizeEffort(options.reasoningEffort)
    case 'google': {
      const thinkingConfig = options.thinkingConfig
      if (!thinkingConfig || typeof thinkingConfig !== 'object' || Array.isArray(thinkingConfig)) {
        return 'default'
      }
      return normalizeEffort((thinkingConfig as Record<string, unknown>).thinkingLevel)
    }
    default:
      return 'default'
  }
}

export function providerDefaultsWithReasoningEffort(
  providerId: ProviderId | string,
  defaults: ProviderDefaultsState,
  effort: ReasoningEffort
): ProviderDefaultsState {
  return {
    ...defaults,
    providerOptions: providerOptionsWithReasoningEffort(
      providerId,
      defaults.providerOptions as Record<string, unknown>,
      effort
    )
  }
}

function providerOptionsWithReasoningEffort(
  providerId: ProviderId | string,
  options: Record<string, unknown>,
  effort: ReasoningEffort
): Record<string, unknown> {
  switch (providerId.toLowerCase()) {
    case 'anthropic':
      return setOrDelete(options, 'effort', effort)
    case 'openai':
    case 'openai-compatible':
      return setOrDelete(options, 'reasoningEffort', effort)
    case 'google':
      return setNestedOrDelete(options, 'thinkingConfig', 'thinkingLevel', effort)
    default:
      return options
  }
}

function setOrDelete(
  input: Record<string, unknown>,
  key: string,
  effort: ReasoningEffort
): Record<string, unknown> {
  const next = { ...input }
  if (effort === 'default') {
    delete next[key]
  } else {
    next[key] = effort
  }
  return pruneEmptyObjects(next)
}

function setNestedOrDelete(
  input: Record<string, unknown>,
  parentKey: string,
  childKey: string,
  effort: ReasoningEffort
): Record<string, unknown> {
  const parent = input[parentKey]
  const nextParent =
    parent && typeof parent === 'object' && !Array.isArray(parent)
      ? { ...(parent as Record<string, unknown>) }
      : {}
  if (effort === 'default') {
    delete nextParent[childKey]
  } else {
    nextParent[childKey] = effort
  }
  return pruneEmptyObjects({ ...input, [parentKey]: nextParent })
}

function normalizeEffort(value: unknown): ReasoningEffort {
  if (typeof value !== 'string') return 'default'
  return EFFORT_VALUES.has(value as ReasoningEffort) ? (value as ReasoningEffort) : 'default'
}

function pruneEmptyObjects(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const pruned = pruneEmptyObjects(child as Record<string, unknown>)
      if (Object.keys(pruned).length > 0) next[key] = pruned
      continue
    }
    if (child !== undefined && child !== '') next[key] = child
  }
  return next
}
