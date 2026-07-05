import type { ProviderOptionField, ProviderOptionSchema } from '@/common/contracts'
import { getPathValue } from '@/features/providers/lib/json'

/**
 * Reasoning effort is schema-driven: the provider option schemas (main
 * process, `provider/options/*.ts`) mark their effort field with
 * `role: 'reasoningEffort'`, and this module only reads that annotation.
 * No per-provider knowledge lives in the renderer.
 *
 * 'default' means "no conversation override" — the provider defaults
 * (and whatever is configured there) apply.
 */
export const DEFAULT_REASONING_EFFORT = 'default'

export interface ReasoningEffortField {
  path: string
  providerKey: string
  choices: string[]
}

/** Locate the effort field and its choices in a provider's option schemas. */
export function reasoningEffortField(
  schemas: ProviderOptionSchema[] | undefined
): ReasoningEffortField | null {
  for (const schema of schemas ?? []) {
    const field: ProviderOptionField | undefined = schema.fields.find(
      (candidate) => candidate.role === 'reasoningEffort'
    )
    if (!field) continue
    const choices = (field.choices ?? [])
      .map((choice) => String(choice.value))
      .filter((value) => value.length > 0)
    return { path: field.path, providerKey: schema.providerKey, choices }
  }
  return null
}

/** Cycle order for the composer badge: default first, then schema choices. */
export function reasoningEffortCycle(field: ReasoningEffortField): string[] {
  return [DEFAULT_REASONING_EFFORT, ...field.choices]
}

/**
 * The effort the provider defaults would apply when the conversation has no
 * override — shown so the badge reflects reality before the user touches it.
 * Provider defaults accept the field both un-scoped (`reasoningEffort`) and
 * scoped (`openai.reasoningEffort`); the merge treats them the same, so read
 * both. Scoped wins, matching the backend merge (raw/scoped over plain).
 */
export function reasoningEffortFromDefaults(
  field: ReasoningEffortField,
  defaults: {
    providerOptions: Record<string, unknown>
    rawProviderOptions: Record<string, unknown>
  }
): string | null {
  const scopedPath = `${field.providerKey}.${field.path}`
  const candidates = [
    getPathValue(defaults.rawProviderOptions, scopedPath),
    getPathValue(defaults.providerOptions, scopedPath),
    getPathValue(defaults.providerOptions, field.path)
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
  }
  return null
}
