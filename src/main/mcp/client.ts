import { createMCPClient, ElicitationRequestSchema, type MCPClient } from '@ai-sdk/mcp'
import { createMcpTransport } from './transport'
import type {
  McpConnectionState,
  McpElicitResult,
  McpGetPromptResult,
  McpImplementationInfo,
  McpListPromptsResult,
  McpListResourcesResult,
  McpListResourceTemplatesResult,
  McpListToolsResult,
  McpReadResourceResult,
  McpServerConfig
} from '@shared/mcp'
import {
  TanzoIntegrationError,
  TanzoNotFoundError,
  TanzoOperationError,
  TanzoTimeoutError
} from '@shared/errors'
import { createLogger } from '../logger'

const log = createLogger('mcp.client')

interface ManagedConnection {
  config: McpServerConfig
  client: MCPClient
}

interface McpClientOptions {
  appName?: string
  appVersion?: string
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  enableReconnect?: boolean
  maxToolRetries?: number
  handleElicitationRequest?: (input: {
    serverName: string
    message: string
    requestedSchema: unknown
  }) => Promise<McpElicitResult>
}

const DEFAULT_CONNECT_TIMEOUT_MS = 120_000
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_MAX_TOOL_RETRIES = 2
const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000
const MAX_PAGINATED_PAGES = 100
const MAX_PAGINATED_ITEMS = 10_000

function isRemoteTransport(config: McpServerConfig): boolean {
  return config.transport === 'http' || config.transport === 'sse'
}

function normalizeConnectionConfig(config: McpServerConfig): string {
  return JSON.stringify({
    transport: config.transport,
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    url: config.url,
    headers: config.headers ?? {},
    redirect: config.redirect,
    env: config.env ?? {}
  })
}

function notFound(serverName: string): Error {
  return new TanzoNotFoundError('MCP_SERVER_NOT_FOUND', `Unknown MCP server "${serverName}".`, {
    details: { serverName }
  })
}

function disabled(serverName: string): Error {
  return new TanzoOperationError('MCP_SERVER_DISABLED', `MCP server "${serverName}" is disabled.`, {
    details: { serverName }
  })
}

function isStaleConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('closed client') ||
    message.includes('session') ||
    message.includes('econnreset') ||
    message.includes('socket hang up')
  )
}

function closeTransport(transport: unknown): void {
  if (!transport || typeof transport !== 'object' || !('close' in transport)) return
  const close = (transport as { close?: () => Promise<void> | void }).close
  if (typeof close !== 'function') return
  void Promise.resolve(close.call(transport)).catch(() => undefined)
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  options?: {
    onTimeout?: () => void
    onLateResolve?: (value: T) => void
  }
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      options?.onTimeout?.()
      reject(new TanzoTimeoutError('MCP_REQUEST_TIMEOUT', message))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timeoutId)
        if (timedOut) {
          options?.onLateResolve?.(value)
          return
        }
        resolve(value)
      },
      (error) => {
        clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

function toImplementationInfo(info: MCPClient['serverInfo']): McpImplementationInfo {
  return {
    name: info.name,
    version: info.version,
    ...(info.title ? { title: info.title } : {})
  }
}

function requestOptions(signal?: AbortSignal, timeoutMs?: number) {
  return {
    ...(signal ? { signal } : {}),
    ...(timeoutMs !== undefined ? { timeout: timeoutMs, maxTotalTimeout: timeoutMs } : {})
  }
}

function assertPaginationLimit(
  serverName: string,
  operation: string,
  pageCount: number,
  itemCount: number
): void {
  if (pageCount > MAX_PAGINATED_PAGES) {
    throw new TanzoIntegrationError(
      'MCP_PAGINATION_LIMIT_EXCEEDED',
      `${operation} for "${serverName}" exceeded ${MAX_PAGINATED_PAGES} pages.`,
      { details: { serverName, operation, pageCount }, recoverable: true }
    )
  }
  if (itemCount > MAX_PAGINATED_ITEMS) {
    throw new TanzoIntegrationError(
      'MCP_PAGINATION_LIMIT_EXCEEDED',
      `${operation} for "${serverName}" exceeded ${MAX_PAGINATED_ITEMS} items.`,
      { details: { serverName, operation, itemCount }, recoverable: true }
    )
  }
}

async function withAbortTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  const controller = new AbortController()
  return withTimeout(operation(controller.signal), timeoutMs, message, {
    onTimeout: () => {
      controller.abort(new TanzoTimeoutError('MCP_REQUEST_TIMEOUT', message))
    }
  })
}

export class McpClient {
  readonly #listeners = new Set<(states: McpConnectionState[]) => void>()
  readonly #configs = new Map<string, McpServerConfig>()
  readonly #connections = new Map<string, ManagedConnection>()
  readonly #states = new Map<string, McpConnectionState>()
  readonly #operations = new Map<string, Promise<void>>()
  readonly #reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #reconnectAttempts = new Map<string, number>()
  #disposed = false
  readonly #appName: string
  readonly #appVersion: string
  readonly #connectTimeoutMs: number
  readonly #requestTimeoutMs: number
  readonly #enableReconnect: boolean
  readonly #maxToolRetries: number
  readonly #handleElicitationRequest: NonNullable<McpClientOptions['handleElicitationRequest']>

  constructor(options: McpClientOptions = {}) {
    this.#appName = options.appName ?? 'tanzo-desktop'
    this.#appVersion = options.appVersion ?? '1.0.0'
    this.#connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.#enableReconnect = options.enableReconnect ?? true
    this.#maxToolRetries = options.maxToolRetries ?? DEFAULT_MAX_TOOL_RETRIES
    this.#handleElicitationRequest =
      options.handleElicitationRequest ?? (async () => ({ action: 'cancel' }))
  }

  async syncServers(servers: McpServerConfig[]): Promise<void> {
    if (this.#disposed) return
    const nextNames = new Set(servers.map((server) => server.name))
    const tasks: Promise<void>[] = []

    for (const existingName of Array.from(this.#configs.keys())) {
      if (!nextNames.has(existingName)) {
        tasks.push(
          this.#withServerOperation(existingName, async () => {
            this.#configs.delete(existingName)
            await this.#disconnect(existingName, { removeState: true })
            this.#clearReconnect(existingName)
          })
        )
      }
    }

    for (const server of servers) {
      tasks.push(
        this.#withServerOperation(server.name, async () => {
          const previous = this.#configs.get(server.name)
          this.#configs.set(server.name, server)

          if (!server.enabled) {
            await this.#disconnect(server.name, { preserveState: true })
            this.#clearReconnect(server.name)
            this.#updateState(server.name, {
              name: server.name,
              status: 'disconnected',
              toolCount: 0
            })
            return
          }

          if (
            previous &&
            normalizeConnectionConfig(previous) === normalizeConnectionConfig(server) &&
            this.#connections.has(server.name)
          ) {
            return
          }

          await this.#connect(server)
        })
      )
    }

    await Promise.allSettled(tasks)
    this.#broadcast()
  }

  listConnectionStates(): McpConnectionState[] {
    return Array.from(this.#states.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  }

  onConnectionStatesChanged(listener: (states: McpConnectionState[]) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async listTools(serverName: string): Promise<McpListToolsResult> {
    return this.#withConnection(serverName, async (connection) => {
      const result = await this.#listAllTools(connection.client, serverName)
      this.#updateState(serverName, {
        name: serverName,
        status: 'connected',
        toolCount: result.tools.length,
        serverInfo: toImplementationInfo(connection.client.serverInfo),
        ...(connection.client.instructions
          ? { instructions: connection.client.instructions }
          : {})
      })
      return result as McpListToolsResult
    })
  }

  async listResources(serverName: string): Promise<McpListResourcesResult> {
    return this.#withConnection(serverName, (connection) =>
      this.#listAllResources(connection.client, serverName)
    )
  }

  async readResource(serverName: string, uri: string): Promise<McpReadResourceResult> {
    return this.#withConnection(
      serverName,
      async (connection) =>
        (await withAbortTimeout(
          (signal) =>
            connection.client.readResource({
              uri,
              options: requestOptions(signal, this.#requestTimeoutMs)
            }),
          this.#requestTimeoutMs,
          `Reading resource "${uri}" from "${serverName}" timed out.`
        )) as McpReadResourceResult
    )
  }

  async listResourceTemplates(serverName: string): Promise<McpListResourceTemplatesResult> {
    return this.#withConnection(
      serverName,
      async (connection) =>
        (await withAbortTimeout(
          (signal) =>
            connection.client.listResourceTemplates({
              options: requestOptions(signal, this.#requestTimeoutMs)
            }),
          this.#requestTimeoutMs,
          `Listing resource templates for "${serverName}" timed out.`
        )) as McpListResourceTemplatesResult
    )
  }

  async listPrompts(serverName: string): Promise<McpListPromptsResult> {
    return this.#withConnection(serverName, (connection) =>
      this.#listAllPrompts(connection.client, serverName)
    )
  }

  async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, unknown>
  ): Promise<McpGetPromptResult> {
    return this.#withConnection(
      serverName,
      async (connection) =>
        (await withAbortTimeout(
          (signal) =>
            connection.client.experimental_getPrompt({
              name: promptName,
              ...(args ? { arguments: args } : {}),
              options: requestOptions(signal, this.#requestTimeoutMs)
            }),
          this.#requestTimeoutMs,
          `Getting prompt "${promptName}" from "${serverName}" timed out.`
        )) as McpGetPromptResult
    )
  }

  async toolsForServer(serverName: string): Promise<Awaited<ReturnType<MCPClient['tools']>>> {
    return this.#withConnection(serverName, async (connection) => {
      const definitions = await this.#listAllTools(connection.client, serverName)
      return connection.client.toolsFromDefinitions(
        definitions as Parameters<MCPClient['toolsFromDefinitions']>[0]
      )
    })
  }

  async #listAllTools(client: MCPClient, serverName: string): Promise<McpListToolsResult> {
    const tools: McpListToolsResult['tools'] = []
    const seenCursors = new Set<string>()
    let pageCount = 0
    let cursor: string | undefined

    do {
      pageCount += 1
      assertPaginationLimit(serverName, 'Listing tools', pageCount, tools.length)
      const result = (await withAbortTimeout(
        (signal) =>
          client.listTools({
            ...(cursor ? { params: { cursor } } : {}),
            options: requestOptions(signal, this.#requestTimeoutMs)
          }),
        this.#requestTimeoutMs,
        `Listing tools for "${serverName}" timed out.`
      )) as McpListToolsResult
      tools.push(...result.tools)
      assertPaginationLimit(serverName, 'Listing tools', pageCount, tools.length)
      cursor = result.nextCursor
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new TanzoIntegrationError(
            'MCP_PAGINATION_CURSOR_REPEATED',
            `Listing tools for "${serverName}" returned a repeated pagination cursor.`,
            { details: { serverName, operation: 'Listing tools', cursor }, recoverable: true }
          )
        }
        seenCursors.add(cursor)
      }
    } while (cursor)

    return { tools }
  }

  async #listAllResources(client: MCPClient, serverName: string): Promise<McpListResourcesResult> {
    const resources: McpListResourcesResult['resources'] = []
    const seenCursors = new Set<string>()
    let pageCount = 0
    let cursor: string | undefined

    do {
      pageCount += 1
      assertPaginationLimit(serverName, 'Listing resources', pageCount, resources.length)
      const result = (await withAbortTimeout(
        (signal) =>
          client.listResources({
            ...(cursor ? { params: { cursor } } : {}),
            options: requestOptions(signal, this.#requestTimeoutMs)
          }),
        this.#requestTimeoutMs,
        `Listing resources for "${serverName}" timed out.`
      )) as McpListResourcesResult
      resources.push(...result.resources)
      assertPaginationLimit(serverName, 'Listing resources', pageCount, resources.length)
      cursor = result.nextCursor
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new TanzoIntegrationError(
            'MCP_PAGINATION_CURSOR_REPEATED',
            `Listing resources for "${serverName}" returned a repeated pagination cursor.`,
            { details: { serverName, operation: 'Listing resources', cursor }, recoverable: true }
          )
        }
        seenCursors.add(cursor)
      }
    } while (cursor)

    return { resources }
  }

  async #listAllPrompts(client: MCPClient, serverName: string): Promise<McpListPromptsResult> {
    const prompts: McpListPromptsResult['prompts'] = []
    const seenCursors = new Set<string>()
    let pageCount = 0
    let cursor: string | undefined

    do {
      pageCount += 1
      assertPaginationLimit(serverName, 'Listing prompts', pageCount, prompts.length)
      const result = (await withAbortTimeout(
        (signal) =>
          client.experimental_listPrompts({
            ...(cursor ? { params: { cursor } } : {}),
            options: requestOptions(signal, this.#requestTimeoutMs)
          }),
        this.#requestTimeoutMs,
        `Listing prompts for "${serverName}" timed out.`
      )) as McpListPromptsResult
      prompts.push(...result.prompts)
      assertPaginationLimit(serverName, 'Listing prompts', pageCount, prompts.length)
      cursor = result.nextCursor
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new TanzoIntegrationError(
            'MCP_PAGINATION_CURSOR_REPEATED',
            `Listing prompts for "${serverName}" returned a repeated pagination cursor.`,
            { details: { serverName, operation: 'Listing prompts', cursor }, recoverable: true }
          )
        }
        seenCursors.add(cursor)
      }
    } while (cursor)

    return { prompts }
  }

  async reconnectServer(serverName: string): Promise<void> {
    if (this.#disposed) throw notFound(serverName)
    const config = this.#configs.get(serverName)
    if (!config) throw notFound(serverName)
    await this.#withServerOperation(serverName, async () => {
      if (!config.enabled) {
        this.#updateState(serverName, {
          name: serverName,
          status: 'disconnected',
          toolCount: 0
        })
        throw disabled(serverName)
      }
      this.#clearReconnect(config.name)
      await this.#connect(config, { throwOnFailure: true })
      this.#broadcast()
    })
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    for (const timer of this.#reconnectTimers.values()) clearTimeout(timer)
    this.#reconnectTimers.clear()
    this.#reconnectAttempts.clear()
    await Promise.allSettled(Array.from(this.#operations.values()))
    await Promise.allSettled(
      Array.from(this.#connections.keys()).map((serverName) =>
        this.#disconnect(serverName, { removeState: true })
      )
    )
    this.#configs.clear()
    this.#broadcast()
  }

  async #ensureConnected(serverName: string): Promise<ManagedConnection> {
    const existing = this.#connections.get(serverName)
    if (existing) return existing
    const config = this.#configs.get(serverName)
    if (!config) throw notFound(serverName)
    if (!config.enabled) throw disabled(serverName)
    await this.#withServerOperation(serverName, async () => {
      if (this.#connections.get(serverName)) return
      await this.#connect(config)
    })
    const connected = this.#connections.get(serverName)
    if (!connected) {
      throw new TanzoIntegrationError(
        'MCP_SERVER_CONNECT_FAILED',
        `Failed to connect MCP server "${serverName}".`,
        { details: { serverName }, recoverable: true }
      )
    }
    return connected
  }

  async #withConnection<T>(
    serverName: string,
    operation: (connection: ManagedConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.#ensureConnected(serverName)
    try {
      return await operation(connection)
    } catch (error) {
      if (this.#disposed || !isStaleConnectionError(error)) throw error
      const config = this.#configs.get(serverName)
      if (!config || !config.enabled || !isRemoteTransport(config)) throw error
      log.warn('mcp request hit stale connection; reconnecting once', { serverName })
      await this.#withServerOperation(serverName, async () => {
        this.#clearReconnect(serverName)
        await this.#connect(config)
      })
      const retried = await this.#ensureConnected(serverName)
      return operation(retried)
    }
  }

  async #connect(config: McpServerConfig, options?: { throwOnFailure?: boolean }): Promise<void> {
    if (this.#disposed) return
    this.#clearReconnectTimer(config.name)
    await this.#disconnect(config.name, { preserveState: true })
    this.#updateState(config.name, {
      name: config.name,
      status: 'connecting',
      toolCount: 0
    })

    let client: MCPClient | null = null
    let transport: Awaited<ReturnType<typeof createMcpTransport>> | null = null
    try {
      transport = await createMcpTransport(config, {
        onSessionExpired: () => {
          if (this.#disposed || !this.#enableReconnect) return
          if (!this.#connections.has(config.name)) return
          log.warn('mcp session expired', { serverName: config.name })
          this.#scheduleReconnect(config.name)
        }
      })
      client = await withTimeout(
        createMCPClient({
          transport,
          clientName: this.#appName,
          version: this.#appVersion,
          maxRetries: this.#maxToolRetries,
          capabilities: { elicitation: {} },
          onUncaughtError: (error) => {
            const connection = this.#connections.get(config.name)
            if (!connection || connection.client !== client) return
            this.#connections.delete(config.name)
            void connection.client.close().catch(() => undefined)
            this.#updateState(config.name, {
              name: config.name,
              status: 'error',
              error: error instanceof Error ? error.message : 'MCP connection failed.',
              toolCount: 0
            })
            if (this.#enableReconnect) this.#scheduleReconnect(config.name)
          }
        }),
        this.#connectTimeoutMs,
        `Connecting MCP server "${config.name}" timed out.`,
        {
          onTimeout: () => closeTransport(transport),
          onLateResolve: (lateClient) => {
            void lateClient.close().catch(() => undefined)
          }
        }
      )

      client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
        try {
          const result = await this.#handleElicitationRequest({
            serverName: config.name,
            message: request.params.message,
            requestedSchema: request.params.requestedSchema
          })
          return { ...result }
        } catch {
          return { action: 'cancel' as const }
        }
      })

      if (this.#disposed) {
        await client.close().catch(() => undefined)
        return
      }

      this.#connections.set(config.name, { config, client })
      this.#updateState(config.name, {
        name: config.name,
        status: 'connected',
        toolCount: 0,
        serverInfo: toImplementationInfo(client.serverInfo),
        ...(client.instructions ? { instructions: client.instructions } : {})
      })
      this.#clearReconnect(config.name)
      void this.#refreshToolCount(config.name, client)
    } catch (error) {
      if (client) {
        await client.close().catch(() => undefined)
      } else {
        closeTransport(transport)
      }
      this.#connections.delete(config.name)
      if (this.#disposed) return
      const message = error instanceof Error ? error.message : 'MCP connection failed.'
      log.warn('connect failed', { serverName: config.name, message })
      this.#updateState(config.name, {
        name: config.name,
        status: 'error',
        error: message,
        toolCount: 0
      })
      if (this.#enableReconnect) this.#scheduleReconnect(config.name)
      if (options?.throwOnFailure) {
        if (error instanceof Error) throw error
        throw new TanzoIntegrationError('MCP_SERVER_CONNECT_FAILED', message, {
          details: { serverName: config.name },
          recoverable: true
        })
      }
    }
  }

  async #refreshToolCount(serverName: string, client: MCPClient): Promise<void> {
    try {
      const result = await this.#listAllTools(client, serverName)
      const connection = this.#connections.get(serverName)
      if (!connection || connection.client !== client) return
      this.#updateState(serverName, {
        name: serverName,
        status: 'connected',
        toolCount: result.tools.length,
        serverInfo: toImplementationInfo(client.serverInfo),
        ...(client.instructions ? { instructions: client.instructions } : {})
      })
    } catch {
      const previous = this.#states.get(serverName)
      if (!previous || previous.status !== 'connected') return
      this.#updateState(serverName, {
        ...previous,
        toolCount: undefined
      })
    }
  }

  async #disconnect(
    serverName: string,
    options?: { preserveState?: boolean; removeState?: boolean }
  ): Promise<void> {
    const connection = this.#connections.get(serverName)
    const previousState = this.#states.get(serverName)
    this.#connections.delete(serverName)

    if (connection) {
      await connection.client.close().catch(() => undefined)
    }

    if (options?.removeState) {
      this.#states.delete(serverName)
    } else if (options?.preserveState) {
      this.#states.set(serverName, {
        name: serverName,
        status: 'disconnected',
        ...(previousState?.status === 'error' && previousState.error
          ? { error: previousState.error }
          : {}),
        toolCount: 0,
        ...(previousState?.serverInfo ? { serverInfo: previousState.serverInfo } : {}),
        ...(previousState?.instructions ? { instructions: previousState.instructions } : {})
      })
    }
  }

  #scheduleReconnect(serverName: string): void {
    if (this.#disposed) return
    const config = this.#configs.get(serverName)
    if (!config || !config.enabled || !isRemoteTransport(config)) {
      this.#clearReconnect(serverName)
      return
    }
    if (this.#reconnectTimers.has(serverName)) return

    const attempt = (this.#reconnectAttempts.get(serverName) ?? 0) + 1
    this.#reconnectAttempts.set(serverName, attempt)

    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      this.#updateState(serverName, {
        name: serverName,
        status: 'error',
        error: `Reconnect attempts exhausted for "${serverName}".`,
        toolCount: 0
      })
      return
    }

    const delayMs = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1),
      MAX_RECONNECT_DELAY_MS
    )

    this.#updateState(serverName, {
      name: serverName,
      status: 'connecting',
      error: `Reconnecting in ${delayMs}ms (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}).`,
      toolCount: 0
    })

    const timer = setTimeout(() => {
      this.#reconnectTimers.delete(serverName)
      const latest = this.#configs.get(serverName)
      if (!latest || !latest.enabled) {
        this.#clearReconnect(serverName)
        return
      }
      void this.#withServerOperation(serverName, async () => {
        if (this.#disposed) return
        await this.#connect(latest)
      })
    }, delayMs)

    this.#reconnectTimers.set(serverName, timer)
  }

  #clearReconnect(serverName: string): void {
    this.#clearReconnectTimer(serverName)
    this.#reconnectAttempts.delete(serverName)
  }

  #clearReconnectTimer(serverName: string): void {
    const timer = this.#reconnectTimers.get(serverName)
    if (timer) {
      clearTimeout(timer)
      this.#reconnectTimers.delete(serverName)
    }
  }

  #updateState(serverName: string, state: McpConnectionState): void {
    this.#states.set(serverName, state)
    this.#broadcast()
  }

  #broadcast(): void {
    const snapshot = this.listConnectionStates()
    for (const listener of this.#listeners) listener(snapshot)
  }

  async #withServerOperation(serverName: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.#operations.get(serverName) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const queued = current.catch(() => undefined)
    this.#operations.set(serverName, queued)
    try {
      await current
    } finally {
      if (this.#operations.get(serverName) === queued) {
        this.#operations.delete(serverName)
      }
    }
  }
}
