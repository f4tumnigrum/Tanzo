import type { ProviderOptionField, ProviderOptionSchema } from '@shared/provider'

export interface ReasoningEffortField {
  path: string
  choices: string[]

  default: string
}

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

    const fallback = choices.includes(marked) ? marked : choices[0]
    return { path: field.path, choices, default: fallback }
  }
  return null
}

export function reasoningEffortCycle(field: ReasoningEffortField): string[] {
  return field.choices
}
