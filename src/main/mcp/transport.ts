import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { McpServerConfig } from '@shared/mcp'
import { TanzoValidationError } from '@shared/errors'
import { expandMcpServerConfig, normalizeStdioEnv } from './env'
import { resolveStdioLaunchCommand } from './stdio-command'

export interface RemoteTransportHooks {
  onSessionExpired?: (sessionId: string) => void
  onSessionIdChange?: (sessionId: string | undefined) => void
}

export async function createMcpTransport(config: McpServerConfig, hooks?: RemoteTransportHooks) {
  const expanded = expandMcpServerConfig(config)

  if (expanded.transport === 'stdio') {
    if (!expanded.command) {
      throw new TanzoValidationError(
        'MCP_STDIO_COMMAND_MISSING',
        `MCP server "${expanded.name}" is missing a command.`
      )
    }

    const env = normalizeStdioEnv(expanded.env)
    const launch = resolveStdioLaunchCommand(expanded.command, expanded.args ?? [], env, {
      cwd: expanded.cwd
    })

    return new Experimental_StdioMCPTransport({
      command: launch.command,
      args: launch.args,
      env,
      stderr: 'inherit',
      cwd: expanded.cwd
    })
  }

  if (!expanded.url) {
    throw new TanzoValidationError(
      'MCP_REMOTE_URL_MISSING',
      `MCP server "${expanded.name}" is missing a URL.`
    )
  }

  let protocol: string
  try {
    protocol = new URL(expanded.url).protocol
  } catch {
    throw new TanzoValidationError(
      'MCP_REMOTE_URL_INVALID',
      `MCP server "${expanded.name}" has an invalid URL.`
    )
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new TanzoValidationError(
      'MCP_REMOTE_URL_INVALID',
      `MCP server "${expanded.name}" must use http or https.`
    )
  }

  return {
    type: expanded.transport,
    url: expanded.url,
    ...(expanded.headers && Object.keys(expanded.headers).length > 0
      ? { headers: { ...expanded.headers } }
      : {}),
    redirect: expanded.redirect ?? 'follow',
    ...(hooks?.onSessionExpired ? { onSessionExpired: hooks.onSessionExpired } : {}),
    ...(hooks?.onSessionIdChange ? { onSessionIdChange: hooks.onSessionIdChange } : {})
  }
}
