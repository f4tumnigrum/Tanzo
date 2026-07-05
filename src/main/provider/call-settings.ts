import { z } from 'zod'
import { TanzoValidationError } from '@shared/errors'

/**
 * Language-model call settings stored in provider defaults
 * (`ProviderDefaultsState.callDefaults`) and forwarded to the AI SDK.
 *
 * The schema is the single source of truth for which settings exist:
 * - Writes are strict (`parseCallSettings`): unknown keys or mistyped values
 *   reject the save, so misconfiguration surfaces in the UI instead of being
 *   silently dropped at call time.
 * - Reads are lenient (`coerceCallSettings`): rows written before validation
 *   existed may carry junk, which is dropped field by field.
 */
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

/** Strict parse for the save path. Throws `PROVIDER_CALL_SETTINGS_INVALID`. */
export function parseCallSettings(value: Record<string, unknown>): CallSettings {
  const result = callSettingsSchema.safeParse(value)
  if (result.success) return result.data
  throw new TanzoValidationError(
    'PROVIDER_CALL_SETTINGS_INVALID',
    `Invalid call settings: ${result.error.issues.map(issueText).join('; ')}`,
    { details: { issues: result.error.issues } }
  )
}

/** Lenient parse for the read path: keep valid fields, drop everything else. */
export function coerceCallSettings(value: Record<string, unknown>): CallSettings {
  const out: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    const parsed = callSettingsSchema.shape[key].safeParse(value[key])
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data
  }
  return out as CallSettings
}
