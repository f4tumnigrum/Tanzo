import type { ProviderOptionField, ProviderOptionSchema } from '@/common/contracts'

/**
 * Reasoning effort is schema-driven: the provider option schemas (main
 * process, `provider/options/*.ts`) mark their effort field with
 * `role: 'reasoningEffort'`, and this module only reads that annotation.
 * No per-provider knowledge lives in the renderer.
 *
 * 'default' means "no conversation override" — the provider defaults apply.
 */
export const DEFAULT_REASONING_EFFORT = 'default'

export interface ReasoningEffortField {
  path: string
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
    return { path: field.path, choices }
  }
  return null
}

/** Cycle order for the composer badge: default first, then schema choices. */
export function reasoningEffortCycle(field: ReasoningEffortField): string[] {
  return [DEFAULT_REASONING_EFFORT, ...field.choices]
}
