import type { McpServerConfig, McpTransportType } from '@shared/mcp'
import type { HookSource } from '@shared/hooks'
import type { PluginMcpServer } from './loader'

export interface PluginHookSourceInput {
  source: Extract<HookSource, 'managed'>

  path: string
}

function mapTransport(type: string | undefined, hasUrl: boolean): McpTransportType {
  switch (type) {
    case 'stdio':
      return 'stdio'
    case 'sse':
      return 'sse'
    case 'http':
    case 'streamable_http':
    case 'streamable-http':
      return 'http'
    default:
      return hasUrl ? 'http' : 'stdio'
  }
}

export function toMcpServerConfig(server: PluginMcpServer): McpServerConfig {
  const transport = mapTransport(server.type, server.url !== undefined)
  return {
    name: server.name,
    transport,
    enabled: true,
    ...(server.command !== undefined ? { command: server.command } : {}),
    ...(server.args !== undefined ? { args: server.args } : {}),
    ...(server.cwd !== undefined ? { cwd: server.cwd } : {}),
    ...(server.url !== undefined ? { url: server.url } : {}),
    ...(server.headers !== undefined ? { headers: server.headers } : {}),
    ...(server.env !== undefined ? { env: server.env } : {})
  }
}
