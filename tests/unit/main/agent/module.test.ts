import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { chatEventChannel } from '@shared/chat'

const mocks = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn() }
  const policyStore = { kind: 'policy-store' }
  const policy = { kind: 'policy' }
  const skills = { kind: 'skills' }
  const identity = {
    resolveAgentType: vi.fn(),
    listAgents: vi.fn(),
    listAgentTypes: vi.fn()
  }
  const store = {
    getConversation: vi.fn((chatId: string) =>
      chatId === 'chat-with-cwd' ? { id: chatId, cwd: '/workspace/chat' } : undefined
    ),
    listConversations: vi.fn(() => [{ id: 'chat-1' }, { id: 'chat-2' }]),
    sweepInterruptedRuns: vi.fn(() => 0),
    pruneActivityHistory: vi.fn()
  }
  const contextDeps = { kind: 'context-deps' }
  const contextEngine = { kind: 'context-engine' }
  const shell = { kind: 'shell' }
  const fs = { kind: 'fs' }
  const search = { kind: 'search' }
  const service = {
    cancel: vi.fn(),
    isRunning: vi.fn(() => true),
    listRunning: vi.fn(() => ['chat-1']),
    settleRuns: vi.fn(async () => true),
    submitUserMessage: vi.fn(async () => undefined),
    spawnTask: vi.fn(() => ({ id: 'explore-1', status: 'running' })),
    awaitTask: vi.fn(async () => ({ summary: 'ok' })),
    getTask: vi.fn(() => ({ id: 'explore-1' })),
    listTasks: vi.fn(() => []),
    instructTask: vi.fn(async () => undefined),
    redefineTask: vi.fn(async () => undefined),
    cancelTask: vi.fn(),
    reportTaskPhase: vi.fn(),
    submitTaskResult: vi.fn()
  }
  const unregisterIpc = vi.fn()
  let identityOptions: { defaultModelRef(): string } | undefined
  let serviceDeps: Record<string, unknown> | undefined
  let toolDeps: Record<string, unknown> | undefined

  return {
    logger,
    policyStore,
    policy,
    skills,
    identity,
    store,
    contextDeps,
    contextEngine,
    shell,
    fs,
    search,
    service,
    unregisterIpc,
    get identityOptions() {
      return identityOptions
    },
    get serviceDeps() {
      return serviceDeps
    },
    get toolDeps() {
      return toolDeps
    },
    createLogger: vi.fn(() => logger),
    createPolicyStore: vi.fn(() => policyStore),
    createPolicyEngine: vi.fn(() => policy),
    createSkillsStore: vi.fn(() => skills),
    createPluginStore: vi.fn(() => ({ kind: 'plugin-store' })),
    createPluginStateStore: vi.fn(() => ({ kind: 'plugin-state' })),
    createPluginsManager: vi.fn(() => ({
      skillRoots: vi.fn(() => []),
      mcpServers: vi.fn(() => []),
      hookSources: vi.fn(() => []),
      onContributionsChanged: vi.fn(() => () => undefined)
    })),
    defaultMarketplaceRoots: vi.fn(() => []),
    createAgentIdentity: vi.fn((options: { defaultModelRef(): string }) => {
      identityOptions = options
      return identity
    }),
    createAgentStore: vi.fn(() => store),
    createContextEngineDeps: vi.fn(() => contextDeps),
    createContextEngine: vi.fn(() => contextEngine),
    createShellRunner: vi.fn(() => shell),
    createWorkspaceFs: vi.fn(() => fs),
    createSearchBackend: vi.fn(() => search),
    createBuildTools: vi.fn((deps: Record<string, unknown>) => {
      toolDeps = deps
      return vi.fn(async (context: unknown) => ({ context }))
    }),
    createAgentService: vi.fn((deps: Record<string, unknown>) => {
      serviceDeps = deps
      return service
    }),
    registerAgentIpc: vi.fn(() => unregisterIpc)
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/user-data') }
}))

vi.mock('@main/logger', () => ({
  createLogger: mocks.createLogger
}))

vi.mock('@main/agent/policy/policy-store', () => ({
  createPolicyStore: mocks.createPolicyStore
}))

vi.mock('@main/agent/policy/engine', () => ({
  createPolicyEngine: mocks.createPolicyEngine
}))

vi.mock('@main/agent/skills/store', () => ({
  createSkillsStore: mocks.createSkillsStore
}))

vi.mock('@main/agent/plugins/manager', () => ({
  createPluginsManager: mocks.createPluginsManager,
  defaultMarketplaceRoots: mocks.defaultMarketplaceRoots
}))

vi.mock('@main/agent/plugins/store', () => ({
  createPluginStore: mocks.createPluginStore
}))

vi.mock('@main/agent/plugins/plugin-state-db', () => ({
  createPluginStateStore: mocks.createPluginStateStore
}))

vi.mock('@main/agent/agents', () => ({
  createAgentIdentity: mocks.createAgentIdentity
}))

vi.mock('@main/agent/store', () => ({
  createAgentStore: mocks.createAgentStore
}))

vi.mock('@main/agent/context/deps', () => ({
  createContextEngineDeps: mocks.createContextEngineDeps
}))

vi.mock('@main/agent/context', () => ({
  createContextEngine: mocks.createContextEngine
}))

vi.mock('@main/agent/shell/runner', () => ({
  createShellRunner: mocks.createShellRunner
}))

vi.mock('@main/agent/fs/workspace-fs', () => ({
  createWorkspaceFs: mocks.createWorkspaceFs
}))

vi.mock('@main/agent/search/backend', () => ({
  createSearchBackend: mocks.createSearchBackend
}))

vi.mock('@main/agent/tools/registry', () => ({
  createBuildTools: mocks.createBuildTools
}))

vi.mock('@main/agent/service', () => ({
  createAgentService: mocks.createAgentService
}))

vi.mock('@main/agent/ipc', () => ({
  registerAgentIpc: mocks.registerAgentIpc
}))

function window(send = vi.fn(), destroyed = false, webContentsDestroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: {
      isDestroyed: vi.fn(() => webContentsDestroyed),
      send
    }
  }
}

describe('agent/module', () => {
  it('wires agent dependencies, tool deps, IPC lifecycle, broadcasts chunks, and closes', async () => {
    const { createAgentModule } = await import('@main/agent/module')
    const providerService = {
      listSetups: vi.fn(
        () =>
          [
            { providerId: 'offline', connection: { status: 'disconnected' }, modalities: {} },
            {
              providerId: 'openai',
              connection: { status: 'connected' },
              modalities: { language: { defaultModelId: 'gpt-4.1', enabledModelIds: ['mini'] } }
            }
          ] as unknown[]
      )
    }
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const db = { prepare: vi.fn() } as never
    const module = createAgentModule({
      db,
      providerService: providerService as never,
      mcpService: { kind: 'mcp', setPluginServers: vi.fn(), syncFromStore: vi.fn() } as never,
      workspaceRoot: '/workspace/root',
      getWindows: () =>
        [window(firstSend), window(vi.fn(), true), window(secondSend, false, true)] as never
    })

    expect(module.service).toBe(mocks.service)
    expect(mocks.createLogger).toHaveBeenCalledWith('agent.module')
    expect(mocks.createPolicyStore).toHaveBeenCalled()
    expect(mocks.createPolicyEngine).toHaveBeenCalledWith(
      expect.objectContaining({ policyStore: mocks.policyStore })
    )
    expect(mocks.createSkillsStore).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: '/workspace/root',
        userDir: join('/user-data', 'agent'),
        logger: mocks.logger,
        db,
        pluginSkillRoots: expect.any(Function)
      })
    )
    expect(mocks.createAgentIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: '/workspace/root', logger: mocks.logger })
    )
    expect(mocks.identityOptions?.defaultModelRef()).toBe('openai:gpt-4.1')

    providerService.listSetups.mockReturnValueOnce([
      {
        providerId: 'fallback',
        connection: { status: 'connected' },
        modalities: { language: { enabledModelIds: ['small'] } }
      }
    ])
    expect(mocks.identityOptions?.defaultModelRef()).toBe('fallback:small')
    providerService.listSetups.mockReturnValueOnce([
      { providerId: 'empty', connection: { status: 'connected' }, modalities: {} }
    ])
    expect(mocks.identityOptions?.defaultModelRef()).toBe('')

    expect(mocks.createAgentStore).toHaveBeenCalledWith(
      expect.anything(),
      mocks.identity,
      mocks.logger,
      '/workspace/root'
    )
    expect(mocks.createContextEngineDeps).toHaveBeenCalledWith({
      userDir: join('/user-data', 'agent'),
      skills: mocks.skills,
      providerService,
      goal: {
        takeInjection: expect.any(Function),
        peekInjection: expect.any(Function),
        get: expect.any(Function)
      },
      policyMode: { getMode: expect.any(Function) }
    })
    expect(mocks.createContextEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        ...mocks.contextDeps,
        extraSections: expect.arrayContaining([expect.objectContaining({ id: 'hooks' })])
      })
    )
    expect(mocks.createShellRunner).toHaveBeenCalled()
    expect(mocks.createAgentService).toHaveBeenCalledWith(
      expect.objectContaining({
        providerService,
        policy: expect.objectContaining({ ...mocks.policy, decide: expect.any(Function) }),
        store: mocks.store,
        identity: mocks.identity,
        send: expect.any(Function),
        skills: mocks.skills,
        logger: mocks.logger,
        contextEngine: mocks.contextEngine
      })
    )

    const send = mocks.serviceDeps?.send as (chatId: string, chunk: unknown) => void
    send('chat-1', { type: 'data-status', id: 'status-1', data: { label: 'hi' }, transient: true })
    expect(firstSend).toHaveBeenCalledWith(chatEventChannel('chat-1'), {
      kind: 'notification',
      chatId: 'chat-1',
      chunk: {
        type: 'data-status',
        id: 'status-1',
        data: { label: 'hi' },
        transient: true
      }
    })
    expect(secondSend).not.toHaveBeenCalled()
    firstSend.mockClear()

    send('chat-1', { type: 'text-delta', textDelta: 'hi' })
    expect(firstSend).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith('dropped untracked non-data chat event', {
      chatId: 'chat-1',
      type: 'text-delta'
    })

    const buildTools = mocks.serviceDeps?.buildTools as (context: {
      chatId: string
      def: unknown
      depth: number
    }) => Promise<unknown>
    await expect(buildTools({ chatId: 'chat-with-cwd', def: {}, depth: 0 })).resolves.toEqual({
      context: { chatId: 'chat-with-cwd', def: {}, depth: 0 }
    })
    expect(mocks.createWorkspaceFs).toHaveBeenCalledWith('/workspace/chat', { dangerous: false })
    expect(mocks.createSearchBackend).toHaveBeenCalledWith('/workspace/chat', { dangerous: false })
    expect(mocks.toolDeps).toMatchObject({
      fs: mocks.fs,
      shell: mocks.shell,
      search: mocks.search,
      skills: mocks.skills,
      logger: mocks.logger,
      store: mocks.store
    })

    const toolDeps = mocks.toolDeps as {
      isRunning(chatId: string): boolean
      cancelConversation(chatId: string): void
      submitUserMessage(chatId: string, message: string): Promise<void>
      rootOf(chatId: string): string
      spawnTask(input: { parentChatId: string; objective: string; agentType: string }): unknown
    }
    expect(toolDeps.isRunning('chat-1')).toBe(true)
    toolDeps.cancelConversation('chat-1')
    await toolDeps.submitUserMessage('chat-1', 'hello')
    toolDeps.spawnTask({ parentChatId: 'chat-1', objective: 'go', agentType: 'explore' })
    expect(mocks.service.cancel).toHaveBeenCalledWith('chat-1')
    expect(mocks.service.submitUserMessage).toHaveBeenCalledWith('chat-1', 'hello')
    expect(mocks.service.spawnTask).toHaveBeenCalledWith({
      parentChatId: 'chat-1',
      objective: 'go',
      agentType: 'explore'
    })

    const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() }
    module.registerIpc(ipcMain as never)
    module.registerIpc(ipcMain as never)
    expect(mocks.registerAgentIpc).toHaveBeenCalledTimes(2)
    expect(mocks.unregisterIpc).toHaveBeenCalledTimes(1)

    await module.close()
    expect(mocks.unregisterIpc).toHaveBeenCalledTimes(2)
    expect(mocks.service.cancel).toHaveBeenCalledWith('chat-1')
    expect(mocks.service.cancel).not.toHaveBeenCalledWith('chat-2')
    expect(mocks.service.listRunning).toHaveBeenCalled()
    expect(mocks.service.settleRuns).toHaveBeenCalledWith(3000)
    expect(mocks.logger.info).toHaveBeenCalledWith('closed')
  })
})
