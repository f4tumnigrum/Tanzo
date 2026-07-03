import { describe, expect, it, vi } from 'vitest'
import { createMcpService } from '@main/mcp/service'

function store() {
  const servers = [{ id: 'server-1', name: 'local', transport: 'stdio', enabled: true }]
  return {
    servers,
    getAll: vi.fn(() => servers),
    create: vi.fn((input: unknown) => ({ id: 'server-2', ...(input as object) })),
    update: vi.fn((id: string, partial: unknown) =>
      id === 'server-1' ? { ...servers[0], ...(partial as object) } : undefined
    ),
    delete: vi.fn((id: string) => id === 'server-1'),
    toggle: vi.fn((id: string, enabled: boolean) =>
      id === 'server-1' ? { ...servers[0], enabled } : undefined
    )
  }
}

function client() {
  return {
    syncServers: vi.fn(),
    listConnectionStates: vi.fn(() => [{ name: 'local', status: 'connected' }]),
    listTools: vi.fn(async (serverName: string) => ({ tools: [{ name: serverName }] })),
    listResources: vi.fn(async (serverName: string) => ({ resources: [{ name: serverName }] })),
    readResource: vi.fn(async (serverName: string, uri: string) => ({
      contents: [{ serverName, uri }]
    })),
    listResourceTemplates: vi.fn(async (serverName: string) => ({
      resourceTemplates: [{ name: serverName }]
    })),
    listPrompts: vi.fn(async (serverName: string) => ({ prompts: [{ name: serverName }] })),
    getPrompt: vi.fn(async (serverName: string, promptName: string, args?: unknown) => ({
      serverName,
      promptName,
      args
    })),
    reconnectServer: vi.fn(async () => undefined),
    toolsForServer: vi.fn(async (serverName: string) => ({ [`${serverName}_tool`]: {} })),
    onConnectionStatesChanged: vi.fn((listener: unknown) => () => listener),
    dispose: vi.fn(async () => undefined)
  }
}

describe('mcp/service', () => {
  it('syncs store mutations to the client and delegates read operations', async () => {
    const fakeStore = store()
    const fakeClient = client()
    const service = createMcpService(fakeStore as never, fakeClient as never)

    expect(service.listServers()).toEqual(fakeStore.servers)
    await service.syncFromStore()
    expect(fakeClient.syncServers).toHaveBeenCalledWith(fakeStore.servers)

    await expect(
      service.createServer({ name: 'created', transport: 'stdio', enabled: true })
    ).resolves.toMatchObject({ id: 'server-2', name: 'created' })
    await expect(service.updateServer('server-1', { description: 'new' })).resolves.toMatchObject({
      description: 'new'
    })
    await expect(service.deleteServer('server-1')).resolves.toBe(true)
    await expect(service.toggleServer('server-1', false)).resolves.toMatchObject({ enabled: false })
    expect(fakeClient.syncServers).toHaveBeenCalledTimes(5)

    await expect(service.updateServer('missing', { enabled: false })).resolves.toBeUndefined()
    await expect(service.deleteServer('missing')).resolves.toBe(false)
    await expect(service.toggleServer('missing', true)).resolves.toBeUndefined()
    expect(fakeClient.syncServers).toHaveBeenCalledTimes(5)

    expect(service.listConnectionStates()).toEqual([{ name: 'local', status: 'connected' }])
    await expect(service.listTools('local')).resolves.toEqual({ tools: [{ name: 'local' }] })
    await expect(service.listResources('local')).resolves.toEqual({
      resources: [{ name: 'local' }]
    })
    await expect(service.readResource('local', 'file:///a')).resolves.toEqual({
      contents: [{ serverName: 'local', uri: 'file:///a' }]
    })
    await expect(service.listResourceTemplates('local')).resolves.toEqual({
      resourceTemplates: [{ name: 'local' }]
    })
    await expect(service.listPrompts('local')).resolves.toEqual({ prompts: [{ name: 'local' }] })
    await expect(service.getPrompt('local', 'prompt', { a: 1 })).resolves.toEqual({
      serverName: 'local',
      promptName: 'prompt',
      args: { a: 1 }
    })
    await service.reconnectServer('local')
    await expect(service.toolsForServer('local')).resolves.toEqual({ local_tool: {} })
    const unsubscribe = service.onConnectionStatesChanged(() => undefined)
    expect(typeof unsubscribe).toBe('function')
    await service.dispose()
    expect(fakeClient.dispose).toHaveBeenCalled()
  })

  it('merges plugin-contributed servers, with user servers winning on name collision', async () => {
    const fakeStore = store()
    const fakeClient = client()
    const service = createMcpService(fakeStore as never, fakeClient as never)

    // No provider: only user servers sync.
    await service.syncFromStore()
    expect(fakeClient.syncServers).toHaveBeenLastCalledWith(fakeStore.servers)

    service.setPluginServers(() => [
      // Collides with the user's `local` server: must be dropped.
      { name: 'local', transport: 'stdio', enabled: true },
      // Unique plugin server: must be appended.
      { name: 'plugin-fs', transport: 'stdio', enabled: true }
    ])

    await service.syncFromStore()
    const merged = fakeClient.syncServers.mock.calls.at(-1)?.[0] as { name: string }[]
    expect(merged.map((server) => server.name)).toEqual(['local', 'plugin-fs'])
    // The surviving `local` is the user's database-backed row (has an id).
    expect(merged.find((server) => server.name === 'local')).toMatchObject({ id: 'server-1' })
  })

  it('lists built-in servers alongside user servers, hidden when shadowed by name', async () => {
    const fakeStore = store()
    const fakeClient = client()
    const service = createMcpService(fakeStore as never, fakeClient as never)

    service.setBuiltinServers(() => [
      { name: 'chrome-devtools', transport: 'stdio', enabled: true, builtin: true },
      // Shadowed by the user's `local` server: hidden from the list.
      { name: 'local', transport: 'stdio', enabled: true, builtin: true }
    ])

    const listed = service.listServers()
    expect(listed.map((server) => server.name)).toEqual(['local', 'chrome-devtools'])
    expect(listed.find((server) => server.name === 'chrome-devtools')).toMatchObject({
      builtin: true
    })
    // The listed `local` is the user's row, not the built-in.
    expect(listed.find((server) => server.name === 'local')).toMatchObject({ id: 'server-1' })
  })

  it('re-evaluates the built-in provider on every sync so preference flips apply', async () => {
    const fakeStore = store()
    const fakeClient = client()
    const service = createMcpService(fakeStore as never, fakeClient as never)
    let enabled = true

    service.setBuiltinServers(() => [
      { name: 'chrome-devtools', transport: 'stdio', enabled, builtin: true }
    ])

    await service.syncFromStore()
    let synced = fakeClient.syncServers.mock.calls.at(-1)?.[0] as { name: string }[]
    expect(synced.find((server) => server.name === 'chrome-devtools')).toMatchObject({
      enabled: true
    })

    enabled = false
    await service.syncFromStore()
    synced = fakeClient.syncServers.mock.calls.at(-1)?.[0] as { name: string }[]
    expect(synced.find((server) => server.name === 'chrome-devtools')).toMatchObject({
      enabled: false
    })
  })
})
