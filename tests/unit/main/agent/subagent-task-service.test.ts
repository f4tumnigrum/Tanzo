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
  function createHarness(
    overrides: {
      startChatRun?: ReturnType<typeof vi.fn>
      load?: ReturnType<typeof vi.fn>
      save?: ReturnType<typeof vi.fn>
      hasAdvancedSince?: ReturnType<typeof vi.fn>
      limits?: { global?: number; perRoot?: number }
    } = {}
  ): {
    service: ReturnType<typeof createTaskService>
    tasks: Map<string, SubagentTask>
    policyRemember: ReturnType<typeof vi.fn>
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
    const policyRemember = vi.fn()
    const callbacks = {
      abortRun: vi.fn(),
      clearTransientChatState: vi.fn(),
      currentRunEpoch: vi.fn(() => 0),
      hasAdvancedSince: overrides.hasAdvancedSince ?? vi.fn(() => false),
      isInflight: vi.fn(() => false),
      // Hang forever: the task stays 'running' until cancelled.
      startChatRun: overrides.startChatRun ?? vi.fn(() => new Promise(() => {}))
    }
    const service = createTaskService(
      {
        store: {
          rootOf: vi.fn(() => 'root-chat'),
          transaction: vi.fn((fn: () => unknown) => fn()),
          getConversation: vi.fn(() => ({ id: 'root-chat' })),
          createConversation: vi.fn(() => ({ id: `child-${++childSeq}` })),
          save: overrides.save ?? vi.fn(),
          load: overrides.load ?? vi.fn(async () => []),
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
        policy: { remember: policyRemember } as never
      },
      callbacks,
      overrides.limits ?? {}
    )
    return { service, tasks, policyRemember, callbacks }
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
    // Dependency failures are recorded structurally, not just in prose.
    expect(tasks.get(b.id)?.result?.failedDependencyId).toBe(a.id)
    // An await on B must resolve instead of hanging forever.
    const result = await service.await('root-chat', b.id)
    expect(result.failed).toBe(true)
  })

  it('cascade-retries dependents that failed because of the retried dependency', async () => {
    const { service, tasks } = createHarness()

    const a = service.spawn({ parentChatId: 'root-chat', objective: 'a', agentType: 'explore' })
    const b = service.spawn({
      parentChatId: 'root-chat',
      objective: 'b',
      agentType: 'explore',
      dependsOn: [a.id]
    })
    // An independently failed task that also depends on A but for its own reason.
    const c = service.spawn({ parentChatId: 'root-chat', objective: 'c', agentType: 'explore' })
    tasks.set(c.id, {
      ...tasks.get(c.id)!,
      status: 'failed',
      dependsOn: [a.id],
      result: { summary: '', failed: true, errorMessage: 'model refused' }
    })

    service.cancel('root-chat', a.id)
    expect(tasks.get(b.id)?.status).toBe('failed')
    expect(tasks.get(b.id)?.result?.failedDependencyId).toBe(a.id)

    service.retry('root-chat', a.id)

    // B (failed because of A) resets to pending-blocked on A.
    expect(tasks.get(b.id)?.status).toBe('pending')
    expect(tasks.get(b.id)?.block).toEqual({ kind: 'dependency', taskIds: [a.id] })
    expect(tasks.get(b.id)?.result).toBeUndefined()
    // C failed for its own reason: untouched.
    expect(tasks.get(c.id)?.status).toBe('failed')
    expect(tasks.get(c.id)?.result?.errorMessage).toBe('model refused')
    // A itself restarted.
    expect(tasks.get(a.id)?.status).toBe('running')
  })

  it('cascade-retry falls back to the legacy quoted-id error format for old rows', () => {
    const { service, tasks } = createHarness()

    const a = service.spawn({ parentChatId: 'root-chat', objective: 'a', agentType: 'explore' })
    const b = service.spawn({ parentChatId: 'root-chat', objective: 'b', agentType: 'explore' })
    // Simulate a pre-v2 persisted failure: message references the dep, no
    // structured field.
    tasks.set(a.id, { ...tasks.get(a.id)!, status: 'failed', result: { summary: '', failed: true } })
    tasks.set(b.id, {
      ...tasks.get(b.id)!,
      status: 'failed',
      dependsOn: [a.id],
      result: { summary: '', failed: true, errorMessage: `Dependency '${a.id}' failed: boom` }
    })

    service.retry('root-chat', a.id)

    expect(tasks.get(b.id)?.status).toBe('pending')
    expect(tasks.get(b.id)?.block).toEqual({ kind: 'dependency', taskIds: [a.id] })
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

  it('resolves approvals responded to in the register/surface window (waiter-first ordering)', async () => {
    // The first stream pass leaves one approval-requested tool part behind.
    const approvalMessages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'objective' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-shell',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { cmd: 'pnpm test' },
            approval: { id: 'approval-1' }
          }
        ]
      }
    ]
    // Stateful store: writeObjective/respondApproval both go through save, and
    // each stream pass writes what the model produced (approval part, then the
    // final answer) — mirroring the real transcript lifecycle.
    let transcript: unknown[] = []
    const load = vi.fn(async () => transcript)
    const save = vi.fn((_chatId: string, messages: unknown[]) => {
      transcript = messages
    })
    let streamPasses = 0
    const startChatRun = vi.fn(async () => {
      streamPasses++
      transcript =
        streamPasses === 1
          ? approvalMessages
          : [
              approvalMessages[0],
              {
                id: 'a2',
                role: 'assistant',
                parts: [{ type: 'text', text: 'verified: all green' }]
              }
            ]
      return { aborted: false, streamFailed: false }
    })
    const { service, tasks, policyRemember } = createHarness({ startChatRun, load, save })

    const spawned = service.spawn({
      parentChatId: 'root-chat',
      objective: 'verify the change',
      agentType: 'explore'
    })

    // Wait until the task surfaces the approval block.
    await vi.waitFor(() => {
      expect(tasks.get(spawned.id)?.status).toBe('blocked')
    })
    const approvals = service.listApprovals('root-chat')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].approval.approvalId).toBe('approval-1')

    // Respond immediately — with waiter-first ordering this must resolve the
    // wait even if the response lands right after surfacing.
    await service.respondApproval('root-chat', {
      approvalId: 'approval-1',
      approved: true,
      scope: 'session'
    })
    expect(policyRemember).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'shell', decision: 'approved', scope: 'session' }),
      tasks.get(spawned.id)!.chatId
    )

    // The task must resume, run the second pass, and complete.
    await vi.waitFor(() => {
      expect(tasks.get(spawned.id)?.status).toBe('done')
    })
    expect(tasks.get(spawned.id)?.result?.summary).toBe('verified: all green')
    expect(tasks.get(spawned.id)?.result?.resultSource).toBe('inferred')
  })

  it('respects the per-root concurrency cap and starts queued work as slots free up', async () => {
    // perRoot=1: the second task must wait for the first driver's slot.
    const running = new Set<string>()
    let peakConcurrency = 0
    const resolvers = new Map<string, () => void>()
    const startChatRun = vi.fn((opts: { chatId: string }) => {
      running.add(opts.chatId)
      peakConcurrency = Math.max(peakConcurrency, running.size)
      return new Promise<{ aborted: boolean; streamFailed: boolean }>((resolve) => {
        resolvers.set(opts.chatId, () => {
          running.delete(opts.chatId)
          resolve({ aborted: false, streamFailed: false })
        })
      })
    })
    // Transcript always ends with assistant text so completion succeeds.
    const load = vi.fn(async () => [
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    ])
    const { service, tasks } = createHarness({
      startChatRun: startChatRun as never,
      load,
      limits: { perRoot: 1 }
    })

    const t1 = service.spawn({ parentChatId: 'root-chat', objective: '1', agentType: 'explore' })
    const t2 = service.spawn({ parentChatId: 'root-chat', objective: '2', agentType: 'explore' })

    await vi.waitFor(() => {
      expect(startChatRun).toHaveBeenCalledTimes(1)
    })
    // Only one stream may run; the second is queued on the semaphore.
    expect(peakConcurrency).toBe(1)

    // Release the first; the second must now start.
    resolvers.get(tasks.get(t1.id)!.chatId)!()
    await vi.waitFor(() => {
      expect(startChatRun).toHaveBeenCalledTimes(2)
    })
    expect(peakConcurrency).toBe(1)

    resolvers.get(tasks.get(t2.id)!.chatId)!()
    await vi.waitFor(() => {
      expect(tasks.get(t2.id)?.status).toBe('done')
    })
  })

  it('rolls back the slot when a queued task is cancelled while waiting', async () => {
    const resolvers = new Map<string, () => void>()
    const startChatRun = vi.fn((opts: { chatId: string }) => {
      return new Promise<{ aborted: boolean; streamFailed: boolean }>((resolve) => {
        resolvers.set(opts.chatId, () => resolve({ aborted: false, streamFailed: false }))
      })
    })
    const load = vi.fn(async () => [
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    ])
    const { service, tasks } = createHarness({
      startChatRun: startChatRun as never,
      load,
      limits: { perRoot: 1 }
    })

    const t1 = service.spawn({ parentChatId: 'root-chat', objective: '1', agentType: 'explore' })
    const t2 = service.spawn({ parentChatId: 'root-chat', objective: '2', agentType: 'explore' })
    const t3 = service.spawn({ parentChatId: 'root-chat', objective: '3', agentType: 'explore' })
    await vi.waitFor(() => {
      expect(startChatRun).toHaveBeenCalledTimes(1)
    })

    // Cancel the queued t2 while it waits on the semaphore: its acquire must
    // unwind without leaking the slot, so t3 can still start after t1 frees it.
    service.cancel('root-chat', t2.id)
    expect(tasks.get(t2.id)?.status).toBe('cancelled')

    resolvers.get(tasks.get(t1.id)!.chatId)!()
    await vi.waitFor(() => {
      expect(startChatRun).toHaveBeenCalledTimes(2)
    })
    expect((startChatRun.mock.calls[1][0] as { chatId: string }).chatId).toBe(
      tasks.get(t3.id)!.chatId
    )
  })

  it('silently unwinds a superseded run without failing the task', async () => {
    // hasAdvancedSince flips to true after the stream pass: another writer
    // (e.g. a direct user message into the executor chat) took the epoch.
    let advanced = false
    const hasAdvancedSince = vi.fn(() => advanced)
    const startChatRun = vi.fn(async () => {
      advanced = true
      return { aborted: false, streamFailed: false }
    })
    const load = vi.fn(async () => [
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] }
    ])
    const { service, tasks } = createHarness({
      startChatRun: startChatRun as never,
      load,
      hasAdvancedSince
    })

    const spawned = service.spawn({
      parentChatId: 'root-chat',
      objective: 'superseded work',
      agentType: 'explore'
    })

    // The driver unwinds via TaskInterrupted('superseded'): the task is NOT
    // failed — the newer run owns the chat now.
    await vi.waitFor(() => {
      expect(startChatRun).toHaveBeenCalledTimes(1)
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(tasks.get(spawned.id)?.status).toBe('running')
    expect(tasks.get(spawned.id)?.result).toBeUndefined()
  })

  it('fails a task that finishes with an empty inferred deliverable', async () => {
    // Stream pass succeeds but the transcript has no assistant text and the
    // sub-agent never called report(result).
    let transcript: unknown[] = []
    const load = vi.fn(async () => transcript)
    const save = vi.fn((_chatId: string, messages: unknown[]) => {
      transcript = messages
    })
    const startChatRun = vi.fn(async () => {
      transcript = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'objective' }] }]
      return { aborted: false, streamFailed: false }
    })
    const { service, tasks } = createHarness({ startChatRun, load, save })

    const spawned = service.spawn({
      parentChatId: 'root-chat',
      objective: 'do something',
      agentType: 'explore'
    })

    await vi.waitFor(() => {
      expect(tasks.get(spawned.id)?.status).toBe('failed')
    })
    const result = tasks.get(spawned.id)?.result
    expect(result?.failed).toBe(true)
    expect(result?.failureKind).toBe('logic-error')
    expect(result?.errorMessage).toContain('without a deliverable')
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

  it('rejects a self-dependent spawn before creating any executor conversation', () => {
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
    // Static dependency errors are rejected before any writes: no task row,
    // no orphaned executor conversation, no driver.
    expect(() =>
      service.spawn({
        parentChatId: 'root-chat',
        objective: 'wait on myself',
        agentType: 'explore',
        dependsOn: ['explore-1']
      })
    ).toThrow(/cannot depend on itself/)
    expect(tasks.size).toBe(0)
    expect(callbacks.startChatRun).not.toHaveBeenCalled()
  })

  it('rejects a spawn whose dependency id does not exist, leaving no orphans', () => {
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

    expect(() =>
      service.spawn({
        parentChatId: 'root-chat',
        objective: 'wait on a ghost',
        agentType: 'explore',
        dependsOn: ['nonexistent-9']
      })
    ).toThrow(/'nonexistent-9' not found/)
    expect(tasks.size).toBe(0)
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
