import { describe, expect, it, vi } from 'vitest'
import type { SubagentTask } from '@shared/subagent-task'
import type { ToolDeps } from '@main/agent/tools/types'
import {
  spawnTool,
  awaitTool,
  tasksTool,
  steerTool,
  cancelTaskTool,
  type SubagentType
} from '@main/agent/tools/subagent'
import { reportTool } from '@main/agent/tools/subagent-control'

function task(
  id: string,
  status: SubagentTask['status'],
  overrides: Partial<SubagentTask> = {}
): SubagentTask {
  return {
    id,
    chatId: `chat-${id}`,
    parentChatId: 'parent',
    rootChatId: 'parent',
    agentType: 'explore',
    objective: 'do work',
    status,
    dependsOn: [],
    allowedTools: ['fileRead'],
    phases: [],
    createdAt: 1,
    ...overrides
  }
}

const READ_ONLY: SubagentType = {
  name: 'explore',
  description: 'read-only investigation',
  readOnly: true,
  available: true
}

const RESTRICTED: SubagentType = {
  name: 'verify',
  description: 'runs commands',
  readOnly: false,
  available: false,
  unavailableReason: 'plan mode allows read-only sub-agents only'
}

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const tasks = new Map<string, SubagentTask>()
  return {
    fs: {} as never,
    shell: {} as never,
    search: {} as never,
    mcpService: {} as never,
    skills: {} as never,
    logger: {} as never,
    store: {} as never,
    resolveAgentType: vi.fn((name: string) =>
      name === 'explore'
        ? {
            id: 'explore',
            name: 'explore',
            description: '',
            kind: 'subagent',
            modelRef: '',
            systemPrompt: '',
            allowedTools: ['fileRead']
          }
        : name === 'verify'
          ? {
              id: 'verify',
              name: 'verify',
              description: '',
              kind: 'subagent',
              modelRef: '',
              systemPrompt: '',
              allowedTools: ['shell']
            }
          : name === 'main'
            ? {
                id: 'main',
                name: 'main',
                description: '',
                kind: 'main',
                modelRef: '',
                systemPrompt: '',
                allowedTools: null
              }
            : undefined
    ),
    listAgents: vi.fn(),
    listAgentTypes: vi.fn(),
    isRunning: vi.fn(() => false),
    cancelConversation: vi.fn(),
    submitUserMessage: vi.fn(async () => undefined),
    rootOf: vi.fn(() => 'parent'),
    spawnTask: vi.fn((input) => {
      const t = task('explore-1', 'running', { objective: input.objective })
      tasks.set(t.id, t)
      return t
    }),
    awaitTask: vi.fn(async () => ({ summary: 'result text' })),
    getTask: vi.fn((_root: string, id: string) => tasks.get(id) ?? task(id, 'running')),
    listTasks: vi.fn(() => [...tasks.values()]),
    instructTask: vi.fn(async () => undefined),
    redefineTask: vi.fn(async () => undefined),
    cancelTask: vi.fn(),
    reportTaskPhase: vi.fn(),
    submitTaskResult: vi.fn(),
    goal: {} as never,
    ...overrides
  } as unknown as ToolDeps
}

async function exec(toolValue: unknown, input: unknown): Promise<unknown> {
  return (toolValue as { execute: (i: unknown, o: unknown) => unknown }).execute(input, {})
}

describe('main/agent/tools/subagent (tasks)', () => {
  it('spawns a single task and returns its readable id', async () => {
    const d = deps()
    const tool = spawnTool(d, 'parent', [READ_ONLY])
    await expect(
      exec(tool, { tasks: [{ objective: 'search code', agent: 'explore' }] })
    ).resolves.toEqual({
      tasks: [{ task: 'explore-1', status: 'running' }],
      hint: '1 task started. Collect results with: await({tasks:["explore-1"]})'
    })
    expect(d.spawnTask).toHaveBeenCalledWith({
      parentChatId: 'parent',
      objective: 'search code',
      agentType: 'explore'
    })
  })

  it('spawns multiple tasks in one call', async () => {
    const d = deps()
    const tool = spawnTool(d, 'parent', [READ_ONLY])
    await exec(tool, {
      tasks: [
        { objective: 'a', agent: 'explore' },
        { objective: 'b', agent: 'explore' }
      ]
    })
    expect(d.spawnTask).toHaveBeenCalledTimes(2)
  })

  it('passes dependsOn through to spawn', async () => {
    const d = deps()
    const tool = spawnTool(d, 'parent', [READ_ONLY])
    await exec(tool, {
      tasks: [{ objective: 'verify', agent: 'explore', dependsOn: ['explore-1'] }]
    })
    expect(d.spawnTask).toHaveBeenCalledWith(expect.objectContaining({ dependsOn: ['explore-1'] }))
  })

  it('rejects unknown and unavailable agent types', async () => {
    const d = deps()
    const tool = spawnTool(d, 'parent', [READ_ONLY, RESTRICTED])
    await expect(
      exec(tool, { tasks: [{ objective: 'x', agent: 'missing' }] })
    ).resolves.toMatchObject({ error: true })
    await expect(
      exec(tool, { tasks: [{ objective: 'x', agent: 'verify' }] })
    ).resolves.toMatchObject({
      error: true,
      message: expect.stringContaining('unavailable')
    })
    expect(d.spawnTask).not.toHaveBeenCalled()
  })

  it('awaits task results', async () => {
    const d = deps()
    const tool = awaitTool(d, 'parent')
    await expect(exec(tool, { tasks: ['explore-1'] })).resolves.toEqual({
      results: [{ task: 'explore-1', result: { summary: 'result text' } }]
    })
    expect(d.awaitTask).toHaveBeenCalledWith('parent', 'explore-1', undefined)
  })

  it('returns pending tasks and timedOut when the wait times out', async () => {
    const d = deps({
      getTask: vi.fn((_root: string, id: string) => task(id, 'running')),
      // explore-2 never settles within the timeout window
      awaitTask: vi.fn(async (_root: string, id: string) =>
        id === 'explore-1' ? { summary: 'fast' } : new Promise(() => {})
      ) as never
    })
    const tool = awaitTool(d, 'parent')
    const result = (await exec(tool, {
      tasks: ['explore-1', 'explore-2'],
      timeoutMs: 1000
    })) as { results: Array<{ task: string }>; pending?: string[]; timedOut?: boolean }
    expect(result.results.map((r) => r.task)).toEqual(['explore-1'])
    expect(result.pending).toEqual(['explore-2'])
    expect(result.timedOut).toBe(true)
  })

  it('settle:first returns as soon as one task finishes', async () => {
    const d = deps({
      getTask: vi.fn((_root: string, id: string) => task(id, 'running')),
      awaitTask: vi.fn(async (_root: string, id: string) =>
        id === 'explore-1' ? { summary: 'fast' } : new Promise(() => {})
      ) as never
    })
    const tool = awaitTool(d, 'parent')
    const result = (await exec(tool, {
      tasks: ['explore-1', 'explore-2'],
      settle: 'first'
    })) as { results: Array<{ task: string }> }
    expect(result.results.map((r) => r.task)).toEqual(['explore-1'])
  })

  it('inspects one task and lists tasks', async () => {
    const d = deps()
    d.spawnTask({
      parentChatId: 'parent',
      objective: 'o',
      agentType: 'explore'
    })
    await expect(exec(tasksTool(d, 'parent'), { task: 'explore-1' })).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: 'explore-1' })]
    })
    await expect(exec(tasksTool(d, 'parent'), {})).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: 'explore-1' })]
    })
  })

  it('steers (instruct) and cancels tasks', async () => {
    const d = deps()
    await expect(
      exec(steerTool(d, 'parent'), { task: 'explore-1', instruction: 'also check tests' })
    ).resolves.toEqual({ steered: true, mode: 'instructed' })
    expect(d.instructTask).toHaveBeenCalledWith('parent', 'explore-1', 'also check tests')
    await expect(exec(cancelTaskTool(d, 'parent'), { task: 'explore-1' })).resolves.toEqual({
      cancelled: true
    })
    expect(d.cancelTask).toHaveBeenCalledWith('parent', 'explore-1')
  })

  it('steers (redefine) when an objective is supplied', async () => {
    const d = deps()
    await expect(
      exec(steerTool(d, 'parent'), { task: 'explore-1', objective: 'new goal' })
    ).resolves.toEqual({ steered: true, mode: 'redefined' })
    expect(d.redefineTask).toHaveBeenCalledWith('parent', 'explore-1', 'new goal')
  })

  it('report tool forwards phase and result to the service', async () => {
    const d = deps()
    await expect(exec(reportTool(d, 'chat-explore-1'), { phase: 'searching' })).resolves.toEqual({
      ok: true
    })
    expect(d.reportTaskPhase).toHaveBeenCalledWith('chat-explore-1', 'searching')
    await expect(
      exec(reportTool(d, 'chat-explore-1'), { result: 'final findings' })
    ).resolves.toEqual({ ok: true })
    expect(d.submitTaskResult).toHaveBeenCalledWith('chat-explore-1', { summary: 'final findings' })
  })
})
