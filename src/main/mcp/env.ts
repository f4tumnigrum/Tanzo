import type { McpServerConfig } from '@shared/mcp'
import { isSensitiveEnvKey, safeChildEnv } from '../safe-env'

export function expandEnvVarsInString(
  value: string,
  source: NodeJS.ProcessEnv = process.env
): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []
  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent: string) => {
    const [varName, defaultValue] = varContent.split(':-', 2)
    if (!varName) return match
    const envValue = source[varName]
    if (envValue !== undefined) return envValue
    if (defaultValue !== undefined) return defaultValue
    missingVars.push(varName)
    return match
  })

  return { expanded, missingVars }
}

function expandOptionalString(
  value: string | undefined,
  source?: NodeJS.ProcessEnv
): string | undefined {
  if (!value) return undefined
  return expandEnvVarsInString(value, source).expanded
}

function expandOptionalArray(
  values: string[] | undefined,
  source?: NodeJS.ProcessEnv
): string[] | undefined {
  if (!values) return undefined
  return values.map((value) => expandEnvVarsInString(value, source).expanded)
}

function expandOptionalRecord(
  value: Record<string, string> | undefined,
  source?: NodeJS.ProcessEnv
): Record<string, string> | undefined {
  if (!value) return undefined
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      expandEnvVarsInString(key, source).expanded,
      expandEnvVarsInString(entry, source).expanded
    ])
  )
}

function nonSensitiveEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (isSensitiveEnvKey(key)) continue
    safe[key] = value
  }
  return safe
}

export function expandMcpServerConfig(config: McpServerConfig): McpServerConfig {
  const outboundEnv = nonSensitiveEnv()
  return {
    ...config,
    ...(config.command ? { command: expandOptionalString(config.command) } : {}),
    ...(config.args ? { args: expandOptionalArray(config.args) } : {}),
    ...(config.cwd ? { cwd: expandOptionalString(config.cwd) } : {}),
    ...(config.url ? { url: expandOptionalString(config.url, outboundEnv) } : {}),
    ...(config.headers ? { headers: expandOptionalRecord(config.headers, outboundEnv) } : {}),
    ...(config.env ? { env: expandOptionalRecord(config.env) } : {})
  }
}

export function normalizeStdioEnv(env?: Record<string, string>): Record<string, string> {
  // MCP server stdio env is operator-declared configuration (from the MCP
  // config file). The host process.env is filtered through safeChildEnv to
  // strip ambient secrets, but explicit overrides declared in the config are
  // passed through as-is — an MCP server may legitimately need API keys or
  // tokens that the operator has intentionally provided.
  const base = safeChildEnv(undefined)
  return env ? { ...base, ...env } : base
}
