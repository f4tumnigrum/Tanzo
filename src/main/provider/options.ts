import type { JSONObject } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type {
  ModelFamily,
  ProviderDefaultsInput,
  ProviderDefaultsState,
  ProviderId,
  ProviderOptionSchema
} from '@shared/provider'
import { anthropicOptionSchemas } from './options/anthropic'
import { deepseekOptionSchemas } from './options/deepseek'
import { googleOptionSchemas } from './options/google'
import { minimaxOptionSchemas } from './options/minimax'
import { openaiOptionSchemas } from './options/openai'
import { openaiChatOptionSchemas } from './options/openai-chat'
import { openaiCompatibleOptionSchemas } from './options/openai-compatible'
import { zhipuOptionSchemas } from './options/zhipu'

export const EMPTY_DEFAULTS: ProviderDefaultsState = {
  callDefaults: {},
  providerOptions: {},
  rawProviderOptions: {}
}

const UNSAFE_OPTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export const OPTION_SCHEMAS: ProviderOptionSchema[] = [
  ...openaiOptionSchemas,
  ...openaiChatOptionSchemas,
  ...anthropicOptionSchemas,
  ...googleOptionSchemas,
  ...deepseekOptionSchemas,
  ...zhipuOptionSchemas,
  ...minimaxOptionSchemas,
  ...openaiCompatibleOptionSchemas
]

/** Every namespace the AI SDK understands at the top level of providerOptions. */
const KNOWN_PROVIDER_KEYS = new Set(OPTION_SCHEMAS.map((schema) => schema.providerKey))

/**
 * Users may address a namespace by provider id (e.g. 'openai-compatible');
 * the SDK expects the schema's providerKey (e.g. 'openaiCompatible').
 * Derived from OPTION_SCHEMAS — no hardcoded aliases.
 */
const CANONICAL_PROVIDER_KEYS = new Map<string, string>(
  OPTION_SCHEMAS.filter((schema) => schema.providerId !== schema.providerKey).map((schema) => [
    schema.providerId,
    schema.providerKey
  ])
)

export function listOptionSchemas(
  providerId?: ProviderId,
  family?: ModelFamily
): ProviderOptionSchema[] {
  return OPTION_SCHEMAS.filter(
    (schema) =>
      (!providerId || schema.providerId === providerId) && (!family || schema.family === family)
  )
}

/**
 * Build a providerOptions overlay that sets a provider's reasoning-effort
 * field (located via the schema `role`, not a hardcoded path) to the given
 * value. Returns undefined when the provider has no such field, or when the
 * value is not accepted by a strict (select) field — an effort inherited
 * across providers (e.g. anthropic 'max' → openai) must be dropped rather
 * than sent as an invalid API value. Free-form (string) fields accept any
 * value.
 */
export function reasoningEffortOverlay(
  providerId: ProviderId,
  effort: string
): ProviderOptions | undefined {
  for (const schema of listOptionSchemas(providerId, 'language')) {
    const field = schema.fields.find((candidate) => candidate.role === 'reasoningEffort')
    if (!field) continue
    if (field.control === 'select' && !field.choices?.some((choice) => choice.value === effort)) {
      return undefined
    }
    let value: unknown = effort
    const segments = field.path.split('.')
    for (let i = segments.length - 1; i >= 0; i -= 1) value = { [segments[i]]: value }
    return { [schema.providerKey]: value as ProviderOptions[string] }
  }
  return undefined
}

export function normalizeDefaults(input: ProviderDefaultsInput | undefined): ProviderDefaultsState {
  return {
    callDefaults: isPlainObject(input?.callDefaults) ? input.callDefaults : {},
    providerOptions: isPlainObject(input?.providerOptions) ? input.providerOptions : {},
    rawProviderOptions: isPlainObject(input?.rawProviderOptions) ? input.rawProviderOptions : {}
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isUnsafeOptionKey(key: string): boolean {
  return UNSAFE_OPTION_KEYS.has(key)
}

function sanitizeOptionValue(value: unknown): ProviderOptions[string] {
  return isPlainObject(value)
    ? (sanitizeOptionObject(value) as JSONObject)
    : (value as ProviderOptions[string])
}

function sanitizeOptionObject(value: Record<string, unknown>): ProviderOptions {
  const sanitized: ProviderOptions = {}
  for (const [key, child] of Object.entries(value)) {
    if (isUnsafeOptionKey(key)) continue
    sanitized[key] = sanitizeOptionValue(child)
  }
  return sanitized
}

function canonicalProviderOptionKey(key: string): string {
  return CANONICAL_PROVIDER_KEYS.get(key) ?? key
}

export function normalizeStoredDefaults(
  value: ProviderDefaultsState | undefined
): ProviderDefaultsState {
  if (!value) return { ...EMPTY_DEFAULTS }
  return normalizeDefaults(value)
}

/**
 * Build the effective providerOptions for one provider+family from stored
 * defaults. Routing rules:
 *
 * 1. `defaults.providerOptions` keys naming a known provider namespace
 *    (any schema `providerKey`, provider ids canonicalized) pass through at
 *    the top level; all remaining keys are scoped under this provider's own
 *    namespace. So `{ reasoningEffort: 'high' }` saved on openai becomes
 *    `{ openai: { reasoningEffort: 'high' } }`.
 * 2. `defaults.rawProviderOptions` is deep-merged on top verbatim (escape
 *    hatch — no scoping), so raw values win over scoped ones.
 */
export function mergeProviderOptions(
  defaults: ProviderDefaultsState,
  providerId: ProviderId,
  family: ModelFamily
): ProviderOptions {
  return deepMerge(
    scopedProviderOptions(defaults.providerOptions, providerId, family),
    defaults.rawProviderOptions as ProviderOptions,
    true
  )
}

export function mergeProviderOptionsInto(
  base: ProviderOptions,
  overrides: ProviderOptions
): ProviderOptions {
  return deepMerge(base, overrides, true)
}

function deepMerge(
  left: ProviderOptions,
  right: ProviderOptions,
  canonicalizeTopLevel = false
): ProviderOptions {
  const merged: ProviderOptions = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (isUnsafeOptionKey(key)) continue
    const canonicalKey = canonicalizeTopLevel ? canonicalProviderOptionKey(key) : key
    const previous = merged[canonicalKey]
    const sanitizedValue = sanitizeOptionValue(value)
    merged[canonicalKey] =
      isPlainObject(previous) && isPlainObject(sanitizedValue)
        ? (deepMerge(previous as ProviderOptions, sanitizedValue as ProviderOptions) as JSONObject)
        : sanitizedValue
  }
  return merged
}

function scopedProviderOptions(
  providerOptions: Record<string, unknown>,
  providerId: ProviderId,
  family: ModelFamily
): ProviderOptions {
  if (Object.keys(providerOptions).length === 0) {
    return providerOptions as ProviderOptions
  }

  const providerKey = listOptionSchemas(providerId, family)[0]?.providerKey
  if (!providerKey) return providerOptions as ProviderOptions

  const scoped: ProviderOptions = {}
  const passthrough: ProviderOptions = {}

  for (const [key, value] of Object.entries(providerOptions)) {
    if (isUnsafeOptionKey(key)) continue
    const canonicalKey = canonicalProviderOptionKey(key)
    const sanitizedValue = sanitizeOptionValue(value)
    if (KNOWN_PROVIDER_KEYS.has(canonicalKey)) {
      passthrough[canonicalKey] = sanitizedValue
    } else {
      scoped[canonicalKey] = sanitizedValue
    }
  }

  if (Object.keys(scoped).length === 0) return passthrough

  const existing = passthrough[providerKey]
  passthrough[providerKey] =
    isPlainObject(existing) && isPlainObject(scoped)
      ? (deepMerge(existing as ProviderOptions, scoped) as ProviderOptions[string])
      : (scoped as ProviderOptions[string])

  return passthrough
}
