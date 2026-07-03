import { McpClient } from './client'
import type { McpStore } from './store'
import type {
  McpConnectionState,
  McpGetPromptResult,
  McpListPromptsResult,
  McpListResourcesResult,
  McpListResourceTemplatesResult,
  McpListToolsResult,
  McpReadResourceResult,
  McpServerConfig,
  NewMcpServerInput
} from '@shared/mcp'
import type { MCPClient } from '@ai-sdk/mcp'

export type McpAiSdkToolSet = Awaited<ReturnType<MCPClient['tools']>>

export interface McpService {
  /**
   * Servers to surface in settings: user-configured servers plus any built-in
   * servers not shadowed by a user server of the same name. Built-ins carry
   * `builtin: true` and are not editable or deletable.
   */
  listServers(): McpServerConfig[]
  createServer(input: NewMcpServerInput): Promise<McpServerConfig>
  updateServer(id: string, partial: Partial<McpServerConfig>): Promise<McpServerConfig | undefined>
  deleteServer(id: string): Promise<boolean>
  toggleServer(id: string, enabled: boolean): Promise<McpServerConfig | undefined>
  listConnectionStates(): McpConnectionState[]
  listTools(serverName: string): Promise<McpListToolsResult>
  listResources(serverName: string): Promise<McpListResourcesResult>
  readResource(serverName: string, uri: string): Promise<McpReadResourceResult>
  listResourceTemplates(serverName: string): Promise<McpListResourceTemplatesResult>
  listPrompts(serverName: string): Promise<McpListPromptsResult>
  getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, unknown>
  ): Promise<McpGetPromptResult>
  reconnectServer(serverName: string): Promise<void>
  toolsForServer(serverName: string): Promise<McpAiSdkToolSet>
  onConnectionStatesChanged(listener: (states: McpConnectionState[]) => void): () => void
  /**
   * Register a lazy provider of MCP servers contributed by active plugins.
   * Late-bound because the plugin manager is created after the MCP service.
   * Merged into the connection set on every sync; user-configured servers win
   * on name collision (a plugin server is dropped when a database-backed server
   * already claims the same name).
   */
  setPluginServers(provider: () => McpServerConfig[]): void
  /**
   * Register a lazy provider of built-in servers the app itself contributes
   * (e.g. the browser-automation server bound to the embedded browser). Merged
   * with the lowest priority: a user or plugin server of the same name wins, so
   * users can override or disable the built-in by defining their own.
   */
  setBuiltinServers(provider: () => McpServerConfig[]): void
  syncFromStore(): Promise<void>
  dispose(): Promise<void>
}

export function createMcpService(store: McpStore, client: McpClient): McpService {
  let pluginServersProvider: (() => McpServerConfig[]) | null = null
  let builtinServersProvider: (() => McpServerConfig[]) | null = null

  function mergedServers(): McpServerConfig[] {
    const userServers = store.getAll()
    const pluginServers = pluginServersProvider?.() ?? []
    const builtinServers = builtinServersProvider?.() ?? []
    const claimed = new Set(userServers.map((server) => server.name))
    const merged = [...userServers]
    // User servers win over plugins, plugins win over built-ins.
    for (const server of [...pluginServers, ...builtinServers]) {
      if (claimed.has(server.name)) continue
      claimed.add(server.name)
      merged.push(server)
    }
    return merged
  }

  async function syncFromStore(): Promise<void> {
    await client.syncServers(mergedServers())
  }

  /** User servers plus unshadowed built-ins; plugin servers stay out of the
   * settings list (they are surfaced by the plugins UI instead). */
  function listableServers(): McpServerConfig[] {
    const userServers = store.getAll()
    const claimed = new Set(userServers.map((server) => server.name))
    const builtins = (builtinServersProvider?.() ?? []).filter(
      (server) => !claimed.has(server.name)
    )
    return [...userServers, ...builtins]
  }

  return {
    listServers: () => listableServers(),
    async createServer(input) {
      const created = store.create(input)
      await syncFromStore()
      return created
    },
    async updateServer(id, partial) {
      const updated = store.update(id, partial)
      if (updated) await syncFromStore()
      return updated
    },
    async deleteServer(id) {
      const ok = store.delete(id)
      if (ok) await syncFromStore()
      return ok
    },
    async toggleServer(id, enabled) {
      const updated = store.toggle(id, enabled)
      if (updated) await syncFromStore()
      return updated
    },
    listConnectionStates: () => client.listConnectionStates(),
    listTools: (serverName) => client.listTools(serverName),
    listResources: (serverName) => client.listResources(serverName),
    readResource: (serverName, uri) => client.readResource(serverName, uri),
    listResourceTemplates: (serverName) => client.listResourceTemplates(serverName),
    listPrompts: (serverName) => client.listPrompts(serverName),
    getPrompt: (serverName, promptName, args) => client.getPrompt(serverName, promptName, args),
    reconnectServer: (serverName) => client.reconnectServer(serverName),
    toolsForServer: (serverName) => client.toolsForServer(serverName),
    onConnectionStatesChanged: (listener) => client.onConnectionStatesChanged(listener),
    setPluginServers(provider) {
      pluginServersProvider = provider
    },
    setBuiltinServers(provider) {
      builtinServersProvider = provider
    },
    syncFromStore,
    dispose: () => client.dispose()
  }
}
