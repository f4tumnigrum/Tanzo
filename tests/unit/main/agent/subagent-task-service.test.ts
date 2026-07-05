import { describe, expect, it, vi } from 'vitest'
import type { SubagentTask } from '@shared/subagent-task'
import { createTaskService } from '@main/agent/subagent/task-service'

function task(overrides: Partial<SubagentTask> = {}): SubagentTask {
  return {
    id: 'explore-1',
    chatId: 'child-chat',
    parentChatId: 'root-chat',
    rootChatId: 'root-chat',
    agentType: 'explore',
    objective: 'inspect',
    status: 'running',
    dependsOn: [],
    allowedTools: ['fileRead'],
    phases: [],
    createdAt: 1,
    startedAt: 1,
    ...overrides
  }
}

describe('agent/subagent/task-service', () => {
  /**
   * Compact harness for scheduling tests: real semaphores/state machine, mocked
   * store + runtime callbacks. `startChatRun` hangs by default so tasks stay
   * running until explicitly cancelled.
   */
  function createHarness(): {
    service: ReturnType<typeof createTaskService>
    tasks: Map<string, SubagentTask>
    callbacks: {
      abortRun: ReturnType<typeof vi.fn>
      clearTransientChatState: ReturnType<typeof vi.fn>
      currentRunEpoch: ReturnType<typeof vi.fn>
      hasAdvancedSince: ReturnType<typeof vi.fn>
      isInflight: ReturnType<typeof vi.fn>
      startChatRun: ReturnType<typeof vi.fn>
    }
  } {
    const tasks = new Map<string, SubagentTask>()
    let childSeq = 0
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      // Hang forever: the task stays 'running' until cancelled.
      startChatRun: vi.fn(() => new Promise(() => {}))
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          getConversation: vi.fn(() => ({ id: 'root-chat' })),
          createConversation: vi.fn(() => ({ id: `child-${++childSeq}` })),
          save: vi.fn(),
          load: vi.fn(async () => []),
          depthOf: vi.fn(() => 1),
          resolveAgentDefinition: vi.fn(async () => ({
            id: 'explore',
            kind: 'subagent',
            allowedTools: ['fileRead']
          })),
          tasks: {
            get: vi.fn((_rootChatId: string, taskId: string) => tasks.get(taskId)),
            getByChat: vi.fn(
              (chatId: string) => [...tasks.values()].find((t) => t.chatId === chatId)
            ),
            listByRoot: vi.fn(() => [...tasks.values()]),
            update: vi.fn((next: SubagentTask) => tasks.set(next.id, next)),
            insert: vi.fn((t: SubagentTask) => tasks.set(t.id, t)),
            nextSeq: vi.fn(() => tasks.size + 1),
            countByAgent: vi.fn(
              (_root: string, agentType: string) =>
                [...tasks.values()].filter((t) => t.agentType === agentType).length
            )
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {
          resolveAgentType: vi.fn(() => ({
            id: 'explore',
            kind: 'subagent',
            allowedTools: ['fileRead']
          }))
        },
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      {
        compaction: { prepareMessages: vi.fn(async () => []) } as never,
        policy: { remember: vi.fn() } as never
      },
      callbacks
    )
    return { service, tasks, callbacks }
  }

  it('fails dependents fast when a pending dependency is cancelled (no driver finally)', async () => {
    const { service, tasks } = createHarness()

    const a = service.spawn({ parentChatId: 'root-chat', objective: 'a', agentType: 'explore' })
    const b = service.spawn({
      parentChatId: 'root-chat',
      objective: 'b',
      agentType: 'explore',
      dependsOn: [a.id]
    })
    expect(tasks.get(b.id)?.status).toBe('pending')

    service.cancel('root-chat', a.id)

    expect(tasks.get(a.id)?.status).toBe('cancelled')
    // B never had a driver; only the settle-edge reevaluation can fail it.
    expect(tasks.get(b.id)?.status).toBe('failed')
    expect(tasks.get(b.id)?.result?.errorMessage).toContain(`'${a.id}'`)
    // An await on B must resolve instead of hanging forever.
    const result = await service.await('root-chat', b.id)
    expect(result.failed).toBe(true)
  })

  it('reevaluates dependents after cancelTree settles pending tasks', async () => {
    const { service, tasks } = createHarness()

    const a = service.spawn({ parentChatId: 'root-chat', objective: 'a', agentType: 'explore' })
    const b = service.spawn({
      parentChatId: 'root-chat',
      objective: 'b',
      agentType: 'explore',
      dependsOn: [a.id]
    })

    service.cancelTree(tasks.get(a.id)!.chatId)

    expect(tasks.get(a.id)?.status).toBe('cancelled')
    expect(tasks.get(b.id)?.status).toBe('failed')
    const result = await service.await('root-chat', b.id)
    expect(result.failed).toBe(true)
  })

  it('rejects instruct/redefine on settled tasks without aborting anything', async () => {
    const { service, tasks, callbacks } = createHarness()
    const a = service.spawn({ parentChatId: 'root-chat', objective: 'a', agentType: 'explore' })
    service.cancel('root-chat', a.id)
    expect(tasks.get(a.id)?.status).toBe('cancelled')
    callbacks.abortRun.mockClear()

    await expect(service.instruct('root-chat', a.id, 'more')).resolves.toEqual({
      ok: false,
      reason: 'terminal'
    })
    await expect(service.redefine('root-chat', a.id, 'new goal')).resolves.toEqual({
      ok: false,
      reason: 'terminal'
    })
    expect(callbacks.abortRun).not.toHaveBeenCalled()
    // The settled state must remain untouched.
    expect(tasks.get(a.id)?.status).toBe('cancelled')
  })

  it('rejects instruct on a dependency-blocked task instead of bypassing the gate', async () => {
    const { service, tasks, callbacks } = createHarness()
    const a = service.spawn({ parentChatId: 'root-chat', objective: 'a', agentType: 'explore' })
    const b = service.spawn({
      parentChatId: 'root-chat',
      objective: 'b',
      agentType: 'explore',
      dependsOn: [a.id]
    })
    expect(tasks.get(b.id)?.status).toBe('pending')

    await expect(service.instruct('root-chat', b.id, 'start now')).resolves.toEqual({
      ok: false,
      reason: 'dependency-blocked'
    })
    expect(tasks.get(b.id)?.status).toBe('pending')
    expect(tasks.get(b.id)?.block?.kind).toBe('dependency')
    // No driver may start for the gated task (A's own driver is fine).
    const bChatId = tasks.get(b.id)!.chatId
    const bDrivers = callbacks.startChatRun.mock.calls.filter(
      (call) => (call[0] as { chatId: string }).chatId === bChatId
    )
    expect(bDrivers).toHaveLength(0)
  })

  it('cancels a task without recursively cancelling itself forever', () => {
    const tasks = new Map<string, SubagentTask>()
    tasks.set('explore-1', task())
    const update = vi.fn((next: SubagentTask) => tasks.set(next.id, next))
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          tasks: {
            get: vi.fn((_rootChatId: string, taskId: string) => tasks.get(taskId)),
            getByChat: vi.fn(),
            listByRoot: vi.fn(() => [...tasks.values()]),
            update,
            insert: vi.fn(),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {},
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    expect(() => service.cancel('root-chat', 'explore-1')).not.toThrow()
    expect(tasks.get('explore-1')?.status).toBe('cancelled')
    expect(callbacks.abortRun).toHaveBeenCalledWith('child-chat')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('fails orphaned unsettled tasks on reconcile (no live driver)', () => {
    const tasks = new Map<string, SubagentTask>()
    tasks.set('explore-1', task({ status: 'running' }))
    tasks.set('explore-2', task({ id: 'explore-2', chatId: 'child-2', status: 'blocked' }))
    tasks.set('explore-3', task({ id: 'explore-3', chatId: 'child-3', status: 'done' }))
    const update = vi.fn((next: SubagentTask) => tasks.set(next.id, next))
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const unsettled = (): SubagentTask[] =>
      [...tasks.values()].filter((t) => ['pending', 'running', 'blocked'].includes(t.status))
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          tasks: {
            get: vi.fn((_rootChatId: string, taskId: string) => tasks.get(taskId)),
            getByChat: vi.fn(),
            listByRoot: vi.fn(() => [...tasks.values()]),
            listUnsettled: vi.fn(unsettled),
            update,
            insert: vi.fn(),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {},
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    const count = service.reconcileOrphans()
    expect(count).toBe(2)
    expect(tasks.get('explore-1')?.status).toBe('failed')
    expect(tasks.get('explore-2')?.status).toBe('failed')
    expect(tasks.get('explore-3')?.status).toBe('done')
    expect(tasks.get('explore-1')?.result?.errorMessage).toContain('restarted')
  })

  it('fails a self-dependent spawn instead of leaving it pending forever', () => {
    const tasks = new Map<string, SubagentTask>()
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          getConversation: vi.fn(() => ({ id: 'root-chat' })),
          createConversation: vi.fn(() => ({ id: 'child-chat' })),
          save: vi.fn(),
          tasks: {
            get: vi.fn((_rootChatId: string, taskId: string) => tasks.get(taskId)),
            getByChat: vi.fn(),
            listByRoot: vi.fn(() => [...tasks.values()]),
            update: vi.fn((next: SubagentTask) => tasks.set(next.id, next)),
            insert: vi.fn((t: SubagentTask) => tasks.set(t.id, t)),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {
          resolveAgentType: vi.fn(() => ({
            id: 'explore',
            kind: 'subagent',
            allowedTools: ['fileRead']
          }))
        },
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    // 'explore-1' is the id readableId() will assign (countByAgent=0 → n=1),
    // so declaring dependsOn:['explore-1'] makes the task depend on itself.
    const spawned = service.spawn({
      parentChatId: 'root-chat',
      objective: 'wait on myself',
      agentType: 'explore',
      dependsOn: ['explore-1']
    })

    const stored = tasks.get(spawned.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.result?.errorMessage).toContain('cannot depend on itself')
    // The driver must never start for a task that can never run.
    expect(callbacks.startChatRun).not.toHaveBeenCalled()
  })

  it('fails a spawn whose dependency id does not exist', () => {
    const tasks = new Map<string, SubagentTask>()
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          getConversation: vi.fn(() => ({ id: 'root-chat' })),
          createConversation: vi.fn(() => ({ id: 'child-chat' })),
          save: vi.fn(),
          tasks: {
            get: vi.fn((_rootChatId: string, taskId: string) => tasks.get(taskId)),
            getByChat: vi.fn(),
            listByRoot: vi.fn(() => [...tasks.values()]),
            update: vi.fn((next: SubagentTask) => tasks.set(next.id, next)),
            insert: vi.fn((t: SubagentTask) => tasks.set(t.id, t)),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {
          resolveAgentType: vi.fn(() => ({
            id: 'explore',
            kind: 'subagent',
            allowedTools: ['fileRead']
          }))
        },
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    const spawned = service.spawn({
      parentChatId: 'root-chat',
      objective: 'wait on a ghost',
      agentType: 'explore',
      dependsOn: ['nonexistent-9']
    })

    const stored = tasks.get(spawned.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.result?.errorMessage).toContain("'nonexistent-9'")
    expect(callbacks.startChatRun).not.toHaveBeenCalled()
  })

  // Fix #11: instruct/redefine/resumeByChat must await the previous driver's done
  // promise before starting a new one (driverDone map). The guard-path tests below
  // verify the functions are async and handle missing/terminal tasks safely. Full
  // concurrency coverage (two overlapping drivers) requires an integration harness
  // that controls runTask.

  it('instruct returns immediately when the task does not exist', async () => {
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          tasks: {
            get: vi.fn(() => undefined),
            getByChat: vi.fn(),
            listByRoot: vi.fn(() => []),
            update: vi.fn(),
            insert: vi.fn(),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {},
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    // Must resolve (not hang) when task is missing — the guard `if (!task) return` exits.
    await expect(service.instruct('root-chat', 'ghost-1', 'hello')).resolves.toEqual({
      ok: false,
      reason: 'not-found'
    })
    expect(callbacks.abortRun).not.toHaveBeenCalled()
  })

  it('redefine returns immediately when the task does not exist', async () => {
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          tasks: {
            get: vi.fn(() => undefined),
            getByChat: vi.fn(),
            listByRoot: vi.fn(() => []),
            update: vi.fn(),
            insert: vi.fn(),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {},
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    await expect(service.redefine('root-chat', 'ghost-1', 'new objective')).resolves.toEqual({
      ok: false,
      reason: 'not-found'
    })
    expect(callbacks.abortRun).not.toHaveBeenCalled()
  })

  it('resumeByChat returns immediately when no task is bound to the chat', async () => {
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          tasks: {
            get: vi.fn(() => undefined),
            getByChat: vi.fn(() => undefined),
            listByRoot: vi.fn(() => []),
            update: vi.fn(),
            insert: vi.fn(),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {},
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    await expect(service.resumeByChat('ghost-chat')).resolves.toBeUndefined()
    expect(callbacks.abortRun).not.toHaveBeenCalled()
    expect(callbacks.startChatRun).not.toHaveBeenCalled()
  })

  it('resumeByChat does not restart a terminal task', async () => {
    const tasks = new Map<string, SubagentTask>()
    tasks.set('explore-1', task({ status: 'done', chatId: 'child-chat' }))
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: vi.fn(() => false),
      isInflight: vi.fn(() => false),
      startChatRun: vi.fn()
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          tasks: {
            get: vi.fn((_rootChatId: string, taskId: string) => tasks.get(taskId)),
            getByChat: vi.fn((chatId: string) =>
              [...tasks.values()].find((t) => t.chatId === chatId)
            ),
            listByRoot: vi.fn(() => [...tasks.values()]),
            update: vi.fn(),
            insert: vi.fn(),
            nextSeq: vi.fn(() => 1),
            countByAgent: vi.fn(() => 0)
          }
        },
        send: vi.fn(),
        sendTo: vi.fn(),
        identity: {},
        providerService: {},
        buildTools: vi.fn(),
        policy: {}
      } as never,
      { compaction: {} as never, policy: { remember: vi.fn() } as never },
      callbacks
    )

    // A terminal (done) task must not be aborted or restarted by a resume.
    await expect(service.resumeByChat('child-chat')).resolves.toBeUndefined()
    expect(callbacks.abortRun).not.toHaveBeenCalled()
    expect(callbacks.startChatRun).not.toHaveBeenCalled()
  })
})
