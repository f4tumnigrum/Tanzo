import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LanguageModel } from 'ai'
import { requireModelRef, type ProviderId } from '@shared/provider'
import type { CallSettings } from '../../provider/call-settings'
import { getReasoningCapability } from '../../provider/capabilities'
import { mergeProviderOptionsInto, reasoningEffortOverlay } from '../../provider/options'
import type { ProviderService } from '../../provider/service'

export type { CallSettings } from '../../provider/call-settings'

const DEFAULT_MAX_RETRIES = 5

type Reasoning = NonNullable<LanguageModelV4CallOptions['reasoning']>

const STANDARD_REASONING = new Set<Reasoning>([
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
])

export interface LanguageModelConfig {
  model: LanguageModel
  callSettings: CallSettings
  providerOptions: ProviderOptions
  reasoning?: Reasoning
}

export interface ModelConfigOverrides {
  reasoningEffort?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function removePath(
  source: Record<string, unknown>,
  segments: string[]
): { value?: unknown; rest: Record<string, unknown> } {
  const [head, ...tail] = segments
  if (!head || !(head in source)) return { rest: source }
  if (tail.length === 0) {
    const { [head]: value, ...rest } = source
    return { value, rest }
  }

  const child = source[head]
  if (!isRecord(child)) return { rest: source }
  const nested = removePath(child, tail)
  if (nested.value === undefined) return { rest: source }
  const rest = { ...source }
  if (Object.keys(nested.rest).length === 0) delete rest[head]
  else rest[head] = nested.rest
  return { value: nested.value, rest }
}

function takeProviderOption(
  providerOptions: ProviderOptions,
  providerKey: string,
  path: string
): { providerOptions: ProviderOptions; value?: unknown } {
  const scoped = providerOptions[providerKey]
  if (!isRecord(scoped)) return { providerOptions }
  const taken = removePath(scoped, path.split('.'))
  if (taken.value === undefined) return { providerOptions }

  const next = { ...providerOptions } as Record<string, unknown>
  if (Object.keys(taken.rest).length === 0) delete next[providerKey]
  else next[providerKey] = taken.rest
  return { providerOptions: next as ProviderOptions, value: taken.value }
}

function takeProviderReasoning(
  providerOptions: ProviderOptions,
  providerId: ProviderId
): { providerOptions: ProviderOptions; effort?: string } {
  const field = getReasoningCapability(providerId, 'language').effort
  if (!field) return { providerOptions }
  const taken = takeProviderOption(providerOptions, field.providerKey, field.path)
  return {
    providerOptions: taken.providerOptions,
    ...(typeof taken.value === 'string' ? { effort: taken.value } : {})
  }
}

function validEffort(providerId: ProviderId, value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if ((providerId === 'anthropic' || providerId === 'deepseek') && normalized === 'max') {
    return 'xhigh'
  }
  const values = getReasoningCapability(providerId, 'language').effort?.values
  return normalized && normalized !== 'default' && values?.includes(normalized)
    ? normalized
    : undefined
}

function standardReasoning(value: string | undefined): Reasoning | undefined {
  return value && STANDARD_REASONING.has(value as Reasoning) ? (value as Reasoning) : undefined
}

export function resolveLanguageModelConfig(
  providerService: ProviderService,
  modelRef: string,
  overrides?: ModelConfigOverrides
): LanguageModelConfig {
  const { providerId } = requireModelRef(modelRef)
  const callSettings = providerService.getCallSettings(providerId, 'language')
  let providerOptions = providerService.getProviderOptions(providerId, 'language')
  let reasoning: Reasoning | undefined
  const override = validEffort(providerId, overrides?.reasoningEffort)

  if (providerId === 'zhipu') {
    providerOptions = takeProviderOption(
      providerOptions,
      'zhipu',
      'reasoningEffort'
    ).providerOptions
  } else if (providerId === 'minimax') {
    if (override) {
      const overlay = reasoningEffortOverlay(providerId, override)
      if (overlay) providerOptions = mergeProviderOptionsInto(providerOptions, overlay)
    }
  } else {
    const stored = takeProviderReasoning(providerOptions, providerId)
    providerOptions = stored.providerOptions
    reasoning = standardReasoning(override ?? validEffort(providerId, stored.effort))
  }

  return {
    model: providerService.resolveLanguageModel(modelRef),
    callSettings: { maxRetries: DEFAULT_MAX_RETRIES, ...callSettings },
    providerOptions,
    ...(reasoning ? { reasoning } : {})
  }
}

export function hasProviderOptions(options: ProviderOptions): boolean {
  return Object.keys(options).length > 0
}
