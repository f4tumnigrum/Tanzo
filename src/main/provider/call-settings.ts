import { z } from 'zod'
import { TanzoValidationError } from '@shared/errors'

export const callSettingsSchema = z
  .strictObject({
    maxRetries: z.number().int().min(0),
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number(),
    topP: z.number(),
    topK: z.number(),
    presencePenalty: z.number(),
    frequencyPenalty: z.number(),
    seed: z.number(),
    stopSequences: z.array(z.string())
  })
  .partial()

export type CallSettings = z.infer<typeof callSettingsSchema>

const SETTING_KEYS = Object.keys(callSettingsSchema.shape) as (keyof CallSettings)[]

function issueText(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') return `unknown key(s): ${issue.keys.join(', ')}`
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

export function parseCallSettings(value: Record<string, unknown>): CallSettings {
  const result = callSettingsSchema.safeParse(value)
  if (result.success) return result.data
  throw new TanzoValidationError(
    'PROVIDER_CALL_SETTINGS_INVALID',
    `Invalid call settings: ${result.error.issues.map(issueText).join('; ')}`,
    { details: { issues: result.error.issues } }
  )
}

export function coerceCallSettings(value: Record<string, unknown>): CallSettings {
  const out: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    const parsed = callSettingsSchema.shape[key].safeParse(value[key])
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data
  }
  return out as CallSettings
}
