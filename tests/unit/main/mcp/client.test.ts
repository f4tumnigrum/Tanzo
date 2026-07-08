import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TanzoIntegrationError, TanzoNotFoundError, TanzoTimeoutError } from '@shared/errors'
import type { McpServerConfig } from '@shared/mcp'
import { McpClient } from '@main/mcp/client'

type RequestWithCursor = { params?: { cursor?: string } }

const mocks = vi.hoisted(() => {
  class FakeSdkClient {
    serverInfo = { name: 'fake-server', version: '1.0.0', title: 'Fake Server' }
    instructions = 'Use the fake server carefully.'
    closed = false
    elicitationHandler:
      | ((request: { params: { message: string; requestedSchema: unknown } }) => Promise<unknown>)
      | undefined

    onElicitationRequest = vi.fn(
      (_schema: unknown, handler: NonNullable<FakeSdkClient['elicitationHandler']>) => {
        this.elicitationHandler = handler
      }
    )

    listTools = vi.fn(async (request: RequestWithCursor = {}) =>
      request.params?.cursor
        ? {
            tools: [{ name: 'tool-b', inputSchema: { type: 'object' } }]
          }
        : {
            tools: [{ name: 'tool-a', inputSchema: { type: 'object' } }],
            nextCursor: 'tools-2'
          }
    )

    listResources = vi.fn(async (request: RequestWithCursor = {}) =>
      request.params?.cursor
        ? { resources: [{ uri: 'file:///b', name: 'b' }] }
        : { resources: [{ uri: 'file:///a', name: 'a' }], nextCursor: 'resources-2' }
    )

    experimental_listPrompts = vi.fn(async (request: RequestWithCursor = {}) =>
      request.params?.cursor
        ? { prompts: [{ name: 'prompt-b' }] }
        : { prompts: [{ name: 'prompt-a' }], nextCursor: 'prompts-2' }
    )

    readResource = vi.fn(async ({ uri }: { uri: string }) => ({
      contents: [{ uri, text: 'content' }]
    }))

    listResourceTemplates = vi.fn(async () => ({
      resourceTemplates: [{ uriTemplate: 'file:///{name}', name: 'template' }]
    }))

    experimental_getPrompt = vi.fn(
      async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => ({
        description: `Prompt ${name}`,
        messages: [{ role: 'user', content: { type: 'text', text: String(args?.topic ?? '') } }]
      })
    )

    toolsFromDefinitions = vi.fn(async (definitions: unknown) => ({
      converted: definitions
    }))

    close = vi.fn(async () => {
      this.closed = true
    })
  }

  const clients: FakeSdkClient[] = []
  const transports: Array<{ close: ReturnType<typeof vi.fn> }> = []

  return {
    FakeSdkClient,
    clients,
    transports,
    createMCPClient: vi.fn(async () => {
      const client = new FakeSdkClient()
      clients.push(client)
      return client
    }),
    createMcpTransport: vi.fn(async () => {
      const transport = { close: vi.fn(async () => undefined) }
      transports.push(transport)
      return transport
    })
  }
})

vi.mock('@ai-sdk/mcp', () => ({
  ElicitationRequestSchema: { method: 'elicitation/create' },
  createMCPClient: mocks.createMCPClient
}))

vi.mock('@main/mcp/transport', () => ({
  createMcpTransport: mocks.createMcpTransport
}))

vi.mock('@main/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn() }))
}))

const enabledServer: McpServerConfig = {
  id: 1,
  name: 'local',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  enabled: true
}

const disabledServer: McpServerConfig = {
  id: 2,
  name: 'disabled',
  transport: 'stdio',
  command: 'node',
  enabled: false
}

beforeEach(() => {
  vi.useRealTimers()
  mocks.clients.length = 0
  mocks.transports.length = 0
  mocks.createMCPClient.mockClear()
  mocks.createMcpTransport.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mcp/client', () => {
  it('connects servers, paginates capabilities, delegates requests, and disposes', async () => {
    const handleElicitationRequest = vi.fn(async () => ({
      action: 'accept' as const,
      content: { value: 'ok' }
    }))
    const client = new McpClient({
      appName: 'Tanzo Test',
      appVersion: '2.0.0',
      enableReconnect: false,
      requestTimeoutMs: 100,
      handleElicitationRequest
    })
    const snapshots: unknown[] = []
    const unsubscribe = client.onConnectionStatesChanged((states) => snapshots.push(states))

    await client.syncServers([enabledServer])
    const sdk = mocks.clients[0]

    expect(mocks.createMcpTransport).toHaveBeenCalledWith(
      enabledServer,
      expect.objectContaining({ onSessionExpired: expect.any(Function) })
    )
    expect(mocks.createMCPClient).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: mocks.transports[0],
        clientName: 'Tanzo Test',
        version: '2.0.0',
        maxRetries: expect.any(Number),
        capabilities: { elicitation: {} },
        onUncaughtError: expect.any(Function)
      })
    )
    expect(sdk.onElicitationRequest).toHaveBeenCalled()
    expect(client.listConnectionStates()[0]).toMatchObject({
      name: 'local',
      status: 'connected',
      serverInfo: { name: 'fake-server', version: '1.0.0', title: 'Fake Server' },
      instructions: 'Use the fake server carefully.'
    })

    await expect(client.listTools('local')).resolves.toEqual({
      tools: [
        { name: 'tool-a', inputSchema: { type: 'object' } },
        { name: 'tool-b', inputSchema: { type: 'object' } }
      ]
    })
    expect(sdk.listTools).toHaveBeenCalledWith(
      expect.objectContaining({ params: { cursor: 'tools-2' } })
    )
    await expect(client.listResources('local')).resolves.toEqual({
      resources: [
        { uri: 'file:///a', name: 'a' },
        { uri: 'file:///b', name: 'b' }
      ]
    })
    await expect(client.listPrompts('local')).resolves.toEqual({
      prompts: [{ name: 'prompt-a' }, { name: 'prompt-b' }]
    })
    await expect(client.readResource('local', 'file:///a')).resolves.toEqual({
      contents: [{ uri: 'file:///a', text: 'content' }]
    })
    await expect(client.listResourceTemplates('local')).resolves.toEqual({
      resourceTemplates: [{ uriTemplate: 'file:///{name}', name: 'template' }]
    })
    await expect(client.getPrompt('local', 'summarize', { topic: 'coverage' })).resolves.toEqual({
      description: 'Prompt summarize',
      messages: [{ role: 'user', content: { type: 'text', text: 'coverage' } }]
    })
    await expect(client.toolsForServer('local')).resolves.toEqual({
      converted: {
        tools: [
          { name: 'tool-a', inputSchema: { type: 'object' } },
          { name: 'tool-b', inputSchema: { type: 'object' } }
        ]
      }
    })

    await expect(
      sdk.elicitationHandler?.({
        params: { message: 'Need input', requestedSchema: { type: 'object' } }
      })
    ).resolves.toEqual({ action: 'accept', content: { value: 'ok' } })
    expect(handleElicitationRequest).toHaveBeenCalledWith({
      serverName: 'local',
      message: 'Need input',
      requestedSchema: { type: 'object' }
    })

    await client.syncServers([{ ...enabledServer, enabled: false }])
    expect(sdk.close).toHaveBeenCalled()
    expect(client.listConnectionStates()).toEqual([
      expect.objectContaining({ name: 'local', status: 'disconnected', toolCount: 0 })
    ])
    await expect(client.listTools('local')).rejects.toThrow('disabled')

    await client.syncServers([])
    expect(client.listConnectionStates()).toEqual([])
    expect(snapshots.length).toBeGreaterThan(0)
    unsubscribe()
    await client.dispose()
  })

  it('throws for unknown servers, reconnects disabled servers as disconnected, and rejects repeated cursors', async () => {
    const client = new McpClient({ enableReconnect: false })

    await expect(client.listTools('missing')).rejects.toThrow(TanzoNotFoundError)
    await client.syncServers([disabledServer])
    await expect(client.readResource('disabled', 'file:///a')).rejects.toThrow('disabled')
    await expect(client.reconnectServer('disabled')).rejects.toThrow('disabled')
    expect(client.listConnectionStates()).toEqual([
      { name: 'disabled', status: 'disconnected', toolCount: 0 }
    ])

    await client.syncServers([enabledServer])
    const sdk = mocks.clients[0]
    sdk.listResources.mockImplementation(async (request: RequestWithCursor = {}) =>
      request.params?.cursor
        ? { resources: [{ uri: 'file:///again', name: 'again' }], nextCursor: 'same' }
        : { resources: [{ uri: 'file:///first', name: 'first' }], nextCursor: 'same' }
    )

    await expect(client.listResources('local')).rejects.toThrow(TanzoIntegrationError)
    await expect(client.reconnectServer('missing')).rejects.toThrow(TanzoNotFoundError)
  })

  it('times out slow connect and request operations', async () => {
    vi.useFakeTimers()
    mocks.createMCPClient.mockImplementationOnce(() => new Promise(() => undefined))
    const connecting = new McpClient({
      connectTimeoutMs: 5,
      enableReconnect: false
    })
    const sync = connecting.syncServers([enabledServer])
    await vi.advanceTimersByTimeAsync(5)
    await sync
    expect(mocks.transports[0].close).toHaveBeenCalled()
    expect(connecting.listConnectionStates()[0]).toMatchObject({
      name: 'local',
      status: 'error',
      toolCount: 0
    })

    vi.useRealTimers()
    vi.useFakeTimers()
    const client = new McpClient({ requestTimeoutMs: 5, enableReconnect: false })
    await client.syncServers([enabledServer])
    mocks.clients.at(-1)?.readResource.mockImplementationOnce(() => new Promise(() => undefined))

    const read = expect(client.readResource('local', 'file:///slow')).rejects.toThrow(
      TanzoTimeoutError
    )
    await vi.advanceTimersByTimeAsync(5)
    await read
  })

  it('handles uncaught connection errors and schedules reconnect for remote transports', async () => {
    vi.useFakeTimers()
    const client = new McpClient({ enableReconnect: true })
    const remote: McpServerConfig = {
      id: 3,
      name: 'remote',
      transport: 'http',
      url: 'https://mcp.example.test',
      enabled: true
    }

    await client.syncServers([remote])
    const lastCreateCall = mocks.createMCPClient.mock.calls.at(-1) as unknown as [
      { onUncaughtError(error: Error): void }
    ]
    const onUncaughtError = lastCreateCall[0].onUncaughtError

    onUncaughtError(new Error('socket closed'))
    expect(client.listConnectionStates()[0]).toMatchObject({
      name: 'remote',
      status: 'connecting',
      error: expect.stringContaining('Reconnecting in 1000ms')
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.createMCPClient).toHaveBeenCalledTimes(2)
  })

  it('reconnects once and retries when a remote request hits a stale connection', async () => {
    const client = new McpClient({ enableReconnect: true })
    const remote: McpServerConfig = {
      id: 4,
      name: 'remote',
      transport: 'http',
      url: 'https://mcp.example.test',
      enabled: true
    }

    await client.syncServers([remote])
    const firstSdk = mocks.clients[0]
    firstSdk.listTools.mockRejectedValueOnce(
      new Error('Attempted to send a request from a closed client')
    )

    await expect(client.listTools('remote')).resolves.toEqual({
      tools: [
        { name: 'tool-a', inputSchema: { type: 'object' } },
        { name: 'tool-b', inputSchema: { type: 'object' } }
      ]
    })

    expect(mocks.createMCPClient).toHaveBeenCalledTimes(2)
    expect(firstSdk.close).toHaveBeenCalled()
    await client.dispose()
  })

  it('does not reconnect-retry stale errors for stdio transports', async () => {
    const client = new McpClient({ enableReconnect: false })
    await client.syncServers([enabledServer])
    const sdk = mocks.clients[0]
    sdk.listTools.mockRejectedValueOnce(new Error('closed client'))

    await expect(client.listTools('local')).rejects.toThrow('closed client')
    expect(mocks.createMCPClient).toHaveBeenCalledTimes(1)
    await client.dispose()
  })
})
