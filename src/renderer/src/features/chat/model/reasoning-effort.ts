import type { ProviderOptionField, ProviderOptionSchema } from '@shared/provider'

/**
 * Reasoning effort is schema-driven: the provider option schemas (main
 * process, `provider/options/*.ts`) mark their effort field with
 * `role: 'reasoningEffort'`, and this module only reads that annotation.
 * No per-provider knowledge lives in the renderer.
 *
 * There is no synthetic "no override" step. The badge only ever shows a
 * real provider choice; when a conversation has no explicit effort the
 * schema's own `default` choice applies.
 */

export interface ReasoningEffortField {
  path: string
  choices: string[]
  /** The schema's default choice; the badge starts here when unset. */
  default: string
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
    if (choices.length === 0) return null
    const marked = field.default != null ? String(field.default) : ''
    // Fall back to the first choice if the schema forgot to mark a default.
    const fallback = choices.includes(marked) ? marked : choices[0]
    return { path: field.path, choices, default: fallback }
  }
  return null
}

/** Cycle order for the composer badge: the provider's real choices only. */
export function reasoningEffortCycle(field: ReasoningEffortField): string[] {
  return field.choices
}
