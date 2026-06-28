/**
 * Pure adapters that translate a plugin's assembled contributions into the
 * native shapes each Tanzo subsystem consumes.
 *
 * These are the only functions that bridge the plugin world and a subsystem's
 * world, so they live at the edge of the plugins module and depend only on
 * shared types (never on a subsystem's service). The plugin manager exposes
 * data already in these shapes; subsystems stay unaware of plugins.
 */

import type { McpServerConfig, McpTransportType } from '@shared/mcp'
import type { HookSource } from '@shared/hooks'
import type { PluginMcpServer } from './loader'

/**
 * A plugin-contributed hooks config file, tagged as a `managed` source so the
 * hooks subsystem auto-trusts it (Codex's "install = consent" model). This is
 * the shape the hooks discovery layer consumes for plugin sources.
 */
export interface PluginHookSourceInput {
  /** Always `managed` for plugin-contributed hooks. */
  source: Extract<HookSource, 'managed'>
  /** Absolute path to the plugin's `hooks.json`. */
  path: string
}

/**
 * Map a Codex `.mcp.json` transport tag to Tanzo's transport enum.
 * Codex uses `stdio` | `http` | `streamable_http` | `streamable-http`; Tanzo
 * uses `stdio` | `sse` | `http`. When no type is given, infer from whether a
 * URL is present (a URL implies a remote/http server).
 */
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

/**
 * Convert a plugin-declared MCP server into a Tanzo `McpServerConfig`. The
 * result is always `enabled` (a plugin's own enable state gates whether it
 * contributes at all) and carries no `id`, so it is never confused with a
 * user-configured, database-backed server.
 */
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
