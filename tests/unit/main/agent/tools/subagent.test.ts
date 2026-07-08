import { describe, expect, it, vi } from 'vitest'
import { zodSchema } from 'ai'
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
import { noteTool } from '@main/agent/tools/subagent-control'
import {
  awaitInputSchema,
  cancelTaskInputSchema,
  spawnInputSchema,
  steerInputSchema,
  tasksInputSchema
} from '@main/agent/tools/tool-schemas'

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
    notes: [],
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
    instructTask: vi.fn(async () => ({ ok: true }) as const),
    redefineTask: vi.fn(async () => ({ ok: true }) as const),
    cancelTask: vi.fn(),
    addTaskNote: vi.fn(),
    waitForNoteTask: vi.fn(() => new Promise<void>(() => {})),
    goal: {} as never,
    ...overrides
  } as unknown as ToolDeps
}

async function exec(toolValue: unknown, input: unknown): Promise<unknown> {
  return (toolValue as { execute: (i: unknown, o: unknown) => unknown }).execute(input, {})
}

describe('main/agent/tools/subagent (schemas)', () => {
  // Anthropic (and some other providers) reject a top-level anyOf/oneOf/allOf
  // in a tool's input_schema. Every sub-agent tool input must serialize to a
  // plain object at the top level.
  it.each([
    ['spawn', spawnInputSchema],
    ['await', awaitInputSchema],
    ['tasks', tasksInputSchema],
    ['steer', steerInputSchema],
    ['cancel', cancelTaskInputSchema]
  ])('%s input schema has no top-level anyOf/oneOf/allOf', (_name, schema) => {
    const json = zodSchema(schema).jsonSchema as Record<string, unknown>
    expect(json.anyOf).toBeUndefined()
    expect(json.oneOf).toBeUndefined()
    expect(json.allOf).toBeUndefined()
    expect(json.type).toBe('object')
  })
})

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
    expect(d.awaitTask).toHaveBeenCalledWith('parent', 'explore-1', expect.any(AbortSignal))
  })

  it('lists unknown task ids explicitly instead of dropping them', async () => {
    const d = deps({
      getTask: vi.fn((_root: string, id: string) =>
        id === 'explore-1' ? task(id, 'running') : undefined
      )
    })
    const tool = awaitTool(d, 'parent')
    const result = (await exec(tool, { tasks: ['explore-1', 'explorer-2'] })) as {
      results: Array<{ task: string }>
      unknown?: string[]
    }
    expect(result.results.map((r) => r.task)).toEqual(['explore-1'])
    expect(result.unknown).toEqual(['explorer-2'])
  })

  it('errors with the unknown ids when no listed task exists', async () => {
    const d = deps({ getTask: vi.fn(() => undefined) })
    const tool = awaitTool(d, 'parent')
    await expect(exec(tool, { tasks: ['ghost-1', 'ghost-2'] })).resolves.toMatchObject({
      error: true,
      message: expect.stringContaining('ghost-1, ghost-2')
    })
  })

  it('reports partial spawn failure with the already-started ids', async () => {
    const d = deps({
      spawnTask: vi.fn((input: { objective: string }) => {
        if (input.objective === 'b') throw new Error('parent parent not found.')
        return task('explore-1', 'running', { objective: input.objective })
      }) as never
    })
    const tool = spawnTool(d, 'parent', [READ_ONLY])
    const result = await exec(tool, {
      tasks: [
        { objective: 'a', agent: 'explore' },
        { objective: 'b', agent: 'explore' }
      ]
    })
    expect(result).toMatchObject({ error: true })
    const message = (result as { message: string }).message
    expect(message).toContain('explore-1')
    expect(message).toContain('spec 2')
    expect(message).toContain('await or cancel')
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
    })) as {
      results: Array<{ task: string }>
      pending?: Array<{ task: string; status: string; phase?: string; latestNote?: string }>
      timedOut?: boolean
    }
    expect(result.results.map((r) => r.task)).toEqual(['explore-1'])
    expect(result.pending).toHaveLength(1)
    expect(result.pending?.[0]).toMatchObject({ task: 'explore-2', status: 'running' })
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

  it('clears the timeout timer when tasks settle before the deadline', async () => {
    vi.useFakeTimers()
    try {
      const d = deps()
      const tool = awaitTool(d, 'parent')
      await exec(tool, { tasks: ['explore-1'], timeoutMs: 60 * 60_000 })
      // The pending timer must be cleared on the normal completion path;
      // otherwise every await with timeoutMs leaks a timer for up to an hour.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
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

  it('rejects steering a settled task with an actionable error', async () => {
    const d = deps()
    ;(d.instructTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'terminal'
    })
    const result = await exec(steerTool(d, 'parent'), {
      task: 'explore-1',
      instruction: 'more'
    })
    expect(result).toMatchObject({ error: true })
    expect((result as { message: string }).message).toContain('already settled')
    expect((result as { message: string }).message).toContain('spawn a new task')
  })

  it('rejects steering a dependency-blocked task and names the blockers', async () => {
    const d = deps()
    ;(d.getTask as ReturnType<typeof vi.fn>).mockReturnValue(
      task('explore-2', 'pending', { block: { kind: 'dependency', taskIds: ['explore-1'] } })
    )
    ;(d.instructTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'dependency-blocked'
    })
    const result = await exec(steerTool(d, 'parent'), {
      task: 'explore-2',
      instruction: 'go faster'
    })
    expect(result).toMatchObject({ error: true })
    expect((result as { message: string }).message).toContain('explore-1')
  })

  it('note tool forwards the note to the service', async () => {
    const d = deps()
    await expect(
      exec(noteTool(d, 'chat-explore-1'), { note: 'auth is split across 3 files' })
    ).resolves.toEqual({ ok: true })
    expect(d.addTaskNote).toHaveBeenCalledWith('chat-explore-1', 'auth is split across 3 files')
  })

  it('await pending includes phase and latest note for unfinished tasks', async () => {
    const d = deps({
      getTask: vi.fn((_root: string, id: string) =>
        task(id, 'running', {
          phase: 'reading auth module',
          phases: [{ name: 'reading auth module', at: 5 }],
          notes: [{ text: 'found a surprise', at: 7 }]
        })
      ),
      awaitTask: vi.fn(async (_root: string, id: string) =>
        id === 'explore-1' ? { summary: 'fast' } : new Promise(() => {})
      ) as never
    })
    const tool = awaitTool(d, 'parent')
    const result = (await exec(tool, {
      tasks: ['explore-1', 'explore-2'],
      timeoutMs: 1000
    })) as {
      pending?: Array<{ task: string; status: string; phase?: string; latestNote?: string }>
    }
    expect(result.pending?.[0]).toMatchObject({
      task: 'explore-2',
      status: 'running',
      phase: 'reading auth module',
      latestNote: 'found a surprise'
    })
  })

  it('await reports the task in notedTasks when a running task sends a note', async () => {
    // The note appears DURING the wait: start with no notes, add one when the
    // note waiter resolves. notedTasks is computed from that delta.
    const notes: Array<{ text: string; at: number }> = []
    const d = deps({
      getTask: vi.fn((_root: string, id: string) =>
        task(id, 'running', { phase: 'reading', notes: [...notes] })
      ),
      awaitTask: vi.fn(() => new Promise(() => {})) as never,
      waitForNoteTask: vi.fn(async () => {
        notes.push({ text: 'a fork in approach', at: 9 })
      })
    })
    const tool = awaitTool(d, 'parent')
    const result = (await exec(tool, { tasks: ['explore-1'] })) as {
      results: unknown[]
      pending?: Array<{ task: string; latestNote?: string }>
      notedTasks?: string[]
    }
    expect(result.notedTasks).toEqual(['explore-1'])
    expect(result.results).toEqual([])
    expect(result.pending?.[0]).toMatchObject({
      task: 'explore-1',
      latestNote: 'a fork in approach'
    })
  })

  it('reports notedTasks even when another task settles in the same pass', async () => {
    // The multi-task race the single boolean could not represent: explore-1
    // settles while explore-2 emits a note. Both signals must survive.
    const notes2: Array<{ text: string; at: number }> = []
    const d = deps({
      getTask: vi.fn((_root: string, id: string) =>
        id === 'explore-2'
          ? task(id, 'running', { phase: 'searching', notes: [...notes2] })
          : task(id, 'running')
      ),
      awaitTask: vi.fn(async (_root: string, id: string) =>
        id === 'explore-1' ? { summary: 'done fast' } : new Promise(() => {})
      ) as never,
      waitForNoteTask: vi.fn(async (_root: string, id: string) => {
        if (id === 'explore-2') notes2.push({ text: 'heads up from 2', at: 3 })
        else await new Promise(() => {})
      })
    })
    const tool = awaitTool(d, 'parent')
    const result = (await exec(tool, { tasks: ['explore-1', 'explore-2'], settle: 'first' })) as {
      results: Array<{ task: string }>
      pending?: Array<{ task: string; latestNote?: string }>
      notedTasks?: string[]
    }
    expect(result.results.map((r) => r.task)).toEqual(['explore-1'])
    expect(result.notedTasks).toEqual(['explore-2'])
    expect(result.pending?.[0]).toMatchObject({ task: 'explore-2', latestNote: 'heads up from 2' })
  })
})
