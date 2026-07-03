import { describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import type { AgentDefinition } from '@main/agent/agents/types'
import { createBuildTools } from '@main/agent/tools/registry'
import type { ToolDeps } from '@main/agent/tools/types'

function deps(): ToolDeps {
  return {
    fs: { registerReadRoot: vi.fn(), root: '/workspace', resolve: (path: string) => path } as never,
    shell: {} as never,
    shellSessions: {} as never,
    questions: {} as never,
    search: {} as never,
    mcpService: {
      listConnectionStates: vi.fn(() => [{ name: 'server', status: 'connected' }]),
      toolsForServer: vi.fn(async () => ({
        readThing: { inputSchema: {} },
        writeThing: { inputSchema: {} }
      })),
      listTools: vi.fn(async () => ({
        tools: [
          {
            name: 'readThing',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true }
          },
          {
            name: 'writeThing',
            inputSchema: { type: 'object' },
            annotations: { destructiveHint: true }
          }
        ]
      }))
    } as never,
    skills: {
      list: vi.fn(),
      get: vi.fn(() => ({ body: 'body', skillDir: '/skill', allowedTools: null }))
    },
    logger: {} as never,
    store: { getConversation: vi.fn(() => undefined) } as never,
    resolveAgentType: vi.fn(),
    listAgents: vi.fn(() => [{ name: 'Worker', description: 'Does work', kind: 'subagent' }]),
    listAgentTypes: vi.fn(),
    isRunning: vi.fn(),
    cancelConversation: vi.fn(),
    submitUserMessage: vi.fn(),
    rootOf: vi.fn(() => 'c1'),
    spawnTask: vi.fn(),
    awaitTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(() => []),
    instructTask: vi.fn(),
    redefineTask: vi.fn(),
    cancelTask: vi.fn(),
    reportTaskPhase: vi.fn(),
    submitTaskResult: vi.fn(),
    goal: {
      get: vi.fn(() => null),
      markOutcome: vi.fn(() => false)
    },
    browser: {
      requestOpen: vi.fn(() => true)
    } as never,
    disabledTools: () => [],
    browserAutomationEnabled: () => true
  } as unknown as ToolDeps
}

function def(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'main',
    name: 'Main',
    description: '',
    kind: 'main',
    modelRef: 'openai:gpt-5',
    systemPrompt: '',
    allowedTools: null,
    ...overrides
  }
}

const mainAgent: AgentDefinition = def({ id: 'main', name: 'main' })

const safeSubagent: AgentDefinition = {
  id: 'safe',
  name: 'safe',
  description: 'read-only',
  kind: 'subagent',
  modelRef: 'openai:gpt-5',
  systemPrompt: '',
  allowedTools: ['fileRead', 'glob', 'grep']
}

const unsafeFullSubagent: AgentDefinition = {
  id: 'unsafe-full',
  name: 'unsafe-full',
  description: 'full access',
  kind: 'subagent',
  modelRef: 'openai:gpt-5',
  systemPrompt: '',
  allowedTools: null
}

const unsafeShellSubagent: AgentDefinition = {
  id: 'unsafe-shell',
  name: 'unsafe-shell',
  description: 'can shell',
  kind: 'subagent',
  modelRef: 'openai:gpt-5',
  systemPrompt: '',
  allowedTools: ['fileRead', 'shell']
}

function planDeps(): ToolDeps {
  const agents = [safeSubagent, unsafeFullSubagent, unsafeShellSubagent]
  return {
    fs: {} as never,
    shell: {} as never,
    shellSessions: {} as never,
    questions: {} as never,
    search: {} as never,
    mcpService: { listConnectionStates: vi.fn(() => []) } as never,
    skills: {} as never,
    logger: { warn: vi.fn() } as never,
    store: { getConversation: vi.fn(() => undefined) } as never,
    resolveAgentType: vi.fn((name: string) => agents.find((agent) => agent.name === name)),
    listAgents: vi.fn((kind: string) => agents.filter((agent) => agent.kind === kind)),
    listAgentTypes: vi.fn(() => [mainAgent, ...agents]),
    isRunning: vi.fn(),
    cancelConversation: vi.fn(),
    submitUserMessage: vi.fn(),
    rootOf: vi.fn(() => 'chat'),
    spawnTask: vi.fn(() => ({ id: 'explore-1', status: 'running' })),
    awaitTask: vi.fn(async () => ({ summary: 'done' })),
    getTask: vi.fn(() => ({ id: 'explore-1', status: 'running' })),
    listTasks: vi.fn(() => []),
    instructTask: vi.fn(),
    redefineTask: vi.fn(),
    cancelTask: vi.fn(),
    reportTaskPhase: vi.fn(),
    submitTaskResult: vi.fn(),
    goal: { get: vi.fn(), markOutcome: vi.fn() },
    browser: {
      requestOpen: vi.fn(() => true)
    } as never,
    disabledTools: () => [],
    browserAutomationEnabled: () => true
  } as unknown as ToolDeps
}

async function execSpawn(toolSet: ToolSet, input: unknown): Promise<unknown> {
  return (toolSet.spawn as unknown as { execute: (i: unknown, o: unknown) => unknown }).execute(
    input,
    {}
  )
}

describe('main/agent/tools/registry', () => {
  it('merges builtin, MCP, skill, and subagent tools', async () => {
    const tools = await createBuildTools(deps())({
      def: def(),
      chatId: 'c1',
      depth: 0,
      mode: 'default'
    })

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'fileRead',
        'grep',
        'mcp__server__readThing',
        'mcp__server__writeThing',
        'skill',
        'shellStart',
        'shellPoll',
        'askQuestion',
        'browserOpen',
        'spawn'
      ])
    )
    expect(tools.mcp__server__readThing.metadata).toMatchObject({
      tanzo: { kind: 'read', source: { mcp: 'server' } }
    })
  })

  it('removes tools the user disabled in settings', async () => {
    const baseDeps = deps()
    const withDisabled = {
      ...baseDeps,
      disabledTools: () => ['shell']
    }
    const tools = await createBuildTools(withDisabled)({
      def: def(),
      chatId: 'c1',
      depth: 0,
      mode: 'default'
    })

    const keys = Object.keys(tools)
    expect(keys).not.toContain('shell')
    // Untouched tools remain available.
    expect(keys).toContain('fileRead')
  })

  it('removes browserOpen when browser automation is disabled', async () => {
    const withBrowserOff = {
      ...deps(),
      browserAutomationEnabled: () => false
    }
    const tools = await createBuildTools(withBrowserOff)({
      def: def(),
      chatId: 'c1',
      depth: 0,
      mode: 'default'
    })

    const keys = Object.keys(tools)
    expect(keys).not.toContain('browserOpen')
    expect(keys).toContain('fileRead')
  })

  it('removes MCP tools disabled in settings, matching raw mcp ids to sanitized keys', async () => {
    const withDisabledMcp = {
      ...deps(),
      disabledTools: () => ['mcp__server__readThing']
    }
    const tools = await createBuildTools(withDisabledMcp)({
      def: def(),
      chatId: 'c1',
      depth: 0,
      mode: 'default'
    })

    const keys = Object.keys(tools)
    expect(keys).not.toContain('mcp__server__readThing')
    // Sibling tools from the same server stay available.
    expect(keys).toContain('mcp__server__writeThing')
  })

  it('filters allowed tools by exact name, MCP server prefix, and glob patterns', async () => {
    const tools = await createBuildTools(deps())({
      def: def({ allowedTools: ['grep', 'mcp__server__read*'] }),
      chatId: 'c1',
      depth: 3,
      mode: 'default'
    })

    expect(Object.keys(tools).sort()).toEqual(['grep', 'mcp__server__readThing'])
  })

  it('registers askQuestion for main agents in every mode but not subagents', async () => {
    const buildTools = createBuildTools(planDeps())
    const modes = ['default', 'plan', 'yolo', 'dangerous'] as const

    for (const mode of modes) {
      await expect(
        buildTools({ def: mainAgent, chatId: 'chat', depth: 0, mode })
      ).resolves.toHaveProperty('askQuestion')
    }

    const subagentDeps = planDeps()
    vi.mocked(subagentDeps.store.getConversation).mockReturnValue({
      parentConversationId: 'parent'
    } as never)
    await expect(
      createBuildTools(subagentDeps)({ def: mainAgent, chatId: 'child', depth: 1, mode: 'default' })
    ).resolves.not.toHaveProperty('askQuestion')
  })

  it('registers exitPlanMode in plan mode and while completing an approved plan', async () => {
    const buildTools = createBuildTools(planDeps())

    await expect(
      buildTools({ def: mainAgent, chatId: 'chat', depth: 0, mode: 'default' })
    ).resolves.not.toHaveProperty('exitPlanMode')
    await expect(
      buildTools({ def: mainAgent, chatId: 'chat', depth: 0, mode: 'yolo' })
    ).resolves.not.toHaveProperty('exitPlanMode')
    await expect(
      buildTools({ def: mainAgent, chatId: 'chat', depth: 0, mode: 'plan' })
    ).resolves.toHaveProperty('exitPlanMode')
    await expect(
      buildTools({
        def: mainAgent,
        chatId: 'chat',
        depth: 0,
        mode: 'default',
        messages: [
          {
            id: 'assistant-plan',
            role: 'assistant',
            parts: [
              {
                type: 'tool-exitPlanMode',
                toolCallId: 'call-plan',
                state: 'approval-responded',
                input: { plan: 'ship it' },
                approval: { id: 'approval-plan', approved: true }
              }
            ]
          }
        ] as never
      })
    ).resolves.toHaveProperty('exitPlanMode')
  })

  it('exposes plan-mode delegation with read-only types available and restricted ones marked', async () => {
    const buildTools = createBuildTools(planDeps())

    const planTools = await buildTools({ def: mainAgent, chatId: 'chat', depth: 0, mode: 'plan' })
    expect(planTools.spawn).toBeDefined()
    expect(planTools.await).toBeDefined()
    expect(planTools.tasks).toBeDefined()
    await expect(
      execSpawn(planTools, { tasks: [{ objective: 'inspect', agent: 'safe' }] })
    ).resolves.toEqual({
      tasks: [{ task: 'explore-1', status: 'running' }],
      hint: '1 task started. Collect results with: await({tasks:["explore-1"]})'
    })
    await expect(
      execSpawn(planTools, { tasks: [{ objective: 'inspect', agent: 'unsafe-shell' }] })
    ).resolves.toMatchObject({ error: true })

    const defaultTools = await buildTools({
      def: mainAgent,
      chatId: 'chat',
      depth: 0,
      mode: 'default'
    })
    await expect(
      execSpawn(defaultTools, { tasks: [{ objective: 'inspect', agent: 'unsafe-full' }] })
    ).resolves.toEqual({
      tasks: [{ task: 'explore-1', status: 'running' }],
      hint: '1 task started. Collect results with: await({tasks:["explore-1"]})'
    })
  })
})
