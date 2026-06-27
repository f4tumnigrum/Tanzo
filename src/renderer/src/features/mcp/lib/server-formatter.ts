import type { McpServerConfig, ServerFormData } from '@/common/contracts'
import { isRecord } from '@/common/lib/type-guards'
import { TanzoValidationError } from '@shared/errors'
import i18n from '@/i18n'

function tryParseJsonArgs(argsString: string): string[] | null {
  try {
    const parsed = JSON.parse(argsString)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

function parseArgs(argsString: string): string[] {
  if (!argsString || argsString.trim().length === 0) {
    return []
  }

  const jsonArgs = tryParseJsonArgs(argsString)
  if (jsonArgs) {
    return jsonArgs
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of argsString.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if ((char === '"' || char === "'") && quote === null) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = null
      continue
    }
    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (escaping) {
    current += '\\'
  }
  if (current.length > 0) {
    args.push(current)
  }
  return args
}

function parseRequiredJSON(jsonString: string, field: string): unknown {
  try {
    return JSON.parse(jsonString)
  } catch (error) {
    throw new TanzoValidationError(
      'MCP_FORM_JSON_INVALID',
      i18n.t('mcp.server.form.errors.jsonInvalid', { field }),
      { cause: error }
    )
  }
}

function normalizeStringRecord(
  jsonString: string | undefined,
  field: string
): Record<string, string> | undefined {
  if (!jsonString || jsonString.trim().length === 0) return undefined
  const parsed = parseRequiredJSON(jsonString, field)
  if (!isRecord(parsed)) {
    throw new TanzoValidationError(
      'MCP_FORM_JSON_INVALID',
      i18n.t('mcp.server.form.errors.jsonNotObject', { field })
    )
  }

  const entries = Object.entries(parsed)
  if (entries.length === 0) {
    return undefined
  }
  const normalized: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'string') {
      throw new TanzoValidationError(
        'MCP_FORM_JSON_INVALID',
        i18n.t('mcp.server.form.errors.jsonValuesString', { field })
      )
    }
    normalized[key] = value
  }
  return normalized
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function parseServerFormData(
  formData: ServerFormData
): Omit<McpServerConfig, 'id' | 'created_at' | 'updated_at'> {
  const description = trimmedOrUndefined(formData.description)
  const baseConfig: Omit<McpServerConfig, 'id' | 'created_at' | 'updated_at'> = {
    name: formData.name.trim(),
    transport: formData.transport,
    enabled: formData.enabled,
    ...(description ? { description } : {})
  }

  const cwd = trimmedOrUndefined(formData.cwd)
  const stdioConfig =
    formData.transport === 'stdio'
      ? {
          command: formData.command?.trim() ?? '',
          args: formData.args ? parseArgs(formData.args) : [],
          ...(cwd ? { cwd } : {})
        }
      : {}

  const headers =
    formData.transport === 'sse' || formData.transport === 'http'
      ? normalizeStringRecord(formData.headers, 'headers')
      : undefined
  const remoteConfig =
    formData.transport === 'sse' || formData.transport === 'http'
      ? {
          url: formData.url?.trim() ?? '',
          ...(headers ? { headers } : {}),
          ...(formData.redirect ? { redirect: formData.redirect } : {})
        }
      : {}

  const env = normalizeStringRecord(formData.env, 'env')

  return {
    ...baseConfig,
    ...stdioConfig,
    ...remoteConfig,
    ...(env ? { env } : {})
  }
}
