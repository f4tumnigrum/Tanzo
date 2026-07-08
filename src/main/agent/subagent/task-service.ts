import { randomUUID } from 'crypto'
import type { TanzoUIMessage } from '@shared/agent-message'
import type {
  SteerTaskOutcome,
  SubagentTask,
  SubagentTaskApproval,
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalView,
  SubagentTaskResult,
  SubagentTaskStatus
} from '@shared/subagent-task'
import { taskEventChannel } from '@shared/chat'
import { fingerprint, fingerprintFieldsFor } from '../policy/engine'
import { createKeyedSemaphores, createSemaphore } from '../runtime/concurrency'
import { createSignalQueue } from '../runtime/signal-queue'
import { applyApprovalResponse, extractPendingApprovals, lastAssistantText } from './approval-utils'
import { isTaskTerminal, taskTransition, type TaskEvent } from './task.machine'
import type { AgentDefinition } from '../agents/types'
import type { AgentRuntimeDeps, Logger } from '../runtime/types'
import type { AgentStreamFinalState } from '../runtime/stream-runner'
import type { StartStreamInput } from '../runtime/turn-loop'
import type { CompactionCoordinator } from '../runtime/compaction-coordinator'
import type { PolicyEngine } from '../policy/types'

const MAX_CONCURRENT_BACKGROUND = 100

const MAX_CONCURRENT_PER_ROOT = 20

// Human-readable progress label derived from the tool a sub-agent is running.
// Unknown tools fall back to the tool name so new tools still render sensibly.
const PHASE_LABELS: Record<string, string> = {
  fileRead: 'reading files',
  glob: 'searching files',
  grep: 'searching code',
  shell: 'running commands',
  fileWrite: 'writing files',
  fileEdit: 'editing files',
  multiEdit: 'editing files',
  skill: 'loading a skill',
  note: 'noting for parent'
}

function phaseLabel(toolName: string): string {
  return PHASE_LABELS[toolName] ?? `running ${toolName}`
}

class TaskInterrupted extends Error {
  constructor(
    readonly chatId: string,
    readonly reason: 'cancelled' | 'superseded'
  ) {
    super(`Subagent task ${reason}: ${chatId}`)
  }
}

export interface SpawnTaskInput {
  parentChatId: string
  objective: string
  agentType: string
  dependsOn?: string[]
  signal?: AbortSignal
}

export interface TaskService {
  spawn(input: SpawnTaskInput): SubagentTask
  await(rootChatId: string, taskId: string, signal?: AbortSignal): Promise<SubagentTaskResult>
  get(rootChatId: string, taskId: string): SubagentTask | undefined
  list(rootChatId: string, status?: SubagentTaskStatus): SubagentTask[]
  instruct(rootChatId: string, taskId: string, instruction: string): Promise<SteerTaskOutcome>
  redefine(rootChatId: string, taskId: string, objective: string): Promise<SteerTaskOutcome>
  cancel(rootChatId: string, taskId: string): void
  retry(rootChatId: string, taskId: string): void
  resumeByChat(chatId: string): Promise<void>
  addNote(chatId: string, note: string): void
  waitForNote(rootChatId: string, taskId: string, signal?: AbortSignal): Promise<void>
  listApprovals(rootChatId: string): SubagentTaskApprovalView[]
  respondApproval(rootChatId: string, response: SubagentTaskApprovalResponse): Promise<void>
  cancelTree(chatId: string): void
  reconcileOrphans(): number
}

interface TaskRuntimeCallbacks {
  abortRun(chatId: string): void
  clearTransientChatState(chatId: string): void
  currentRunEpoch(chatId: string): number
  hasAdvancedSince(chatId: string, epoch: number): boolean
  isInflight(chatId: string): boolean
  startChatRun(
    opts: StartStreamInput & {
      onProgress?: () => void
      onStart?: (token: { epoch: number }) => void
    }
  ): Promise<AgentStreamFinalState>
}

export interface TaskServiceLimits {
  global?: number

  perRoot?: number
}

export function createTaskService(
  deps: AgentRuntimeDeps & { logger?: Logger },
  collaborators: { compaction: CompactionCoordinator; policy: PolicyEngine },
  callbacks: TaskRuntimeCallbacks,
  limits: TaskServiceLimits = {}
): TaskService {
  const backgroundSlots = createSemaphore(limits.global ?? MAX_CONCURRENT_BACKGROUND)
  const rootSlots = createKeyedSemaphores(limits.perRoot ?? MAX_CONCURRENT_PER_ROOT)
  const controllers = new Map<string, AbortController>()

  const driverDone = new Map<string, Promise<void>>()
  const settleWaiters = new Map<string, Set<() => void>>()
  const noteWaiters = new Map<string, Set<() => void>>()
  const approvalWaiters = new Map<string, () => void>()
  const approvalChains = new Map<string, Promise<void>>()

  const waiterKey = (rootChatId: string, taskId: string): string => `${rootChatId}:${taskId}`

  function broadcastTasks(rootChatId: string): void {
    deps.send(rootChatId, {
      type: 'data-task',
      id: `tasks:${rootChatId}`,
      data: { rootChatId, tasks: deps.store.tasks.listByRoot(rootChatId) },
      transient: true
    })
    deps.send(rootChatId, {
      type: 'data-taskApproval',
      id: `taskApprovals:${rootChatId}`,
      data: { rootChatId, approvals: listApprovals(rootChatId) },
      transient: true
    })
    deps.sendTo?.(taskEventChannel(rootChatId), {
      type: 'tasks',
      rootChatId,
      tasks: deps.store.tasks.listByRoot(rootChatId)
    })
    deps.sendTo?.(taskEventChannel(rootChatId), {
      type: 'approvals',
      rootChatId,
      approvals: listApprovals(rootChatId)
    })
  }

  function persist(task: SubagentTask): void {
    deps.store.tasks.update(task)
    broadcastTasks(task.rootChatId)
  }

  function notifySettled(rootChatId: string, taskId: string): void {
    const key = waiterKey(rootChatId, taskId)
    const waiters = settleWaiters.get(key)
    if (!waiters) return
    settleWaiters.delete(key)
    for (const resolve of waiters) resolve()
  }

  // Soft wake: a mid-task note nudges any parent awaiting this task to return a
  // progress snapshot without settling it. The task keeps running; the parent
  // decides whether to keep waiting, steer, or stop. Waiters are drained (each
  // await returns once); a parent that loops back re-registers.
  function notifyNote(rootChatId: string, taskId: string): void {
    const key = waiterKey(rootChatId, taskId)
    const waiters = noteWaiters.get(key)
    if (!waiters) return
    noteWaiters.delete(key)
    for (const resolve of waiters) resolve()
  }

  const isTerminal = isTaskTerminal

  function dispatch(rootChatId: string, taskId: string, event: TaskEvent): SubagentTask | null {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) return null
    const result = taskTransition(task, event)
    if (result.state === task && result.effects.length === 0) return task
    for (const effect of result.effects) {
      if (effect.kind === 'persist') persist(result.state)
      else if (effect.kind === 'notify-settled') notifySettled(rootChatId, taskId)
      else if (effect.kind === 'wake-note') notifyNote(rootChatId, taskId)
    }
    return result.state
  }

  function readableId(rootChatId: string, agentType: string): string {
    const n = deps.store.tasks.countByAgent(rootChatId, agentType) + 1
    return `${agentType}-${n}`
  }

  function createExecutorConversation(parentChatId: string, agentType: string): string {
    const parent = deps.store.getConversation(parentChatId)
    if (!parent) throw new Error(`Cannot spawn subagent: parent ${parentChatId} not found.`)
    const def = deps.identity.resolveAgentType(agentType)
    if (!def) throw new Error(`Unknown subagent type "${agentType}".`)
    const subagentModelRef = parent.subagentModelRef
    const child = deps.store.createConversation({
      agentId: def.id,
      ...(subagentModelRef ? { modelRef: subagentModelRef, subagentModelRef } : {}),

      ...(parent.reasoningEffort ? { reasoningEffort: parent.reasoningEffort } : {}),
      ...(parent.workspaceId ? { workspaceId: parent.workspaceId } : {}),
      ...(parent.cwd ? { cwd: parent.cwd } : {}),
      parentConversationId: parentChatId,
      parentRelation: 'subagent'
    })
    return child.id
  }

  function writeObjective(chatId: string, objective: string): void {
    deps.store.save(chatId, [
      { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: objective }] }
    ])
  }

  function dependenciesSatisfied(task: SubagentTask): boolean {
    return task.dependsOn.every((depId) => {
      const dep = deps.store.tasks.get(task.rootChatId, depId)
      return dep?.status === 'done'
    })
  }

  function pendingDependencies(task: SubagentTask): string[] {
    return task.dependsOn.filter((depId) => {
      const dep = deps.store.tasks.get(task.rootChatId, depId)
      return dep?.status !== 'done'
    })
  }

  function spawn(input: SpawnTaskInput): SubagentTask {
    const parent = deps.store.getConversation(input.parentChatId)
    if (!parent) throw new Error(`Cannot spawn subagent: parent ${input.parentChatId} not found.`)
    const rootChatId = deps.store.rootOf(input.parentChatId)
    const def = deps.identity.resolveAgentType(input.agentType)
    if (!def) throw new Error(`Unknown subagent type "${input.agentType}".`)

    const id = readableId(rootChatId, input.agentType)
    const dependsOn = input.dependsOn ?? []
    if (dependsOn.includes(id)) {
      throw new Error(
        `Task '${id}' cannot depend on itself; dependsOn must reference other, already-spawned task ids.`
      )
    }
    for (const depId of dependsOn) {
      if (!deps.store.tasks.get(rootChatId, depId)) {
        throw new Error(
          `Dependency '${depId}' not found; dependsOn must reference already-spawned task ids.`
        )
      }
    }
    let task!: SubagentTask
    deps.store.transaction(() => {
      const chatId = createExecutorConversation(input.parentChatId, input.agentType)
      writeObjective(chatId, input.objective)
      const now = Date.now()
      task = {
        id,
        chatId,
        parentChatId: input.parentChatId,
        rootChatId,
        agentType: input.agentType,
        objective: input.objective,
        status: dependsOn.length > 0 ? 'pending' : 'running',
        dependsOn,
        allowedTools: def.allowedTools,
        phases: [],
        notes: [],
        createdAt: now,
        ...(dependsOn.length > 0 ? {} : { startedAt: now })
      }
      if (dependsOn.length > 0 && !dependenciesSatisfied(task)) {
        task.block = { kind: 'dependency', taskIds: pendingDependencies(task) }
      } else {
        task.status = 'running'
        task.startedAt = now
      }
      const seq = deps.store.tasks.nextSeq(rootChatId)
      deps.store.tasks.insert(task, seq)
    })
    broadcastTasks(rootChatId)
    if (task.status === 'pending') {
      const blocker = dependencyUnsatisfiable(task)
      if (blocker) {
        const dep = deps.store.tasks.get(rootChatId, blocker)
        failDependency(
          rootChatId,
          task.id,
          blocker,
          `Dependency '${blocker}' failed: ${dep?.result?.errorMessage ?? 'did not complete successfully'}`
        )
      }

      const fresh = deps.store.tasks.get(rootChatId, task.id)
      if (fresh && isTerminal(fresh.status)) {
        task = fresh
        maybeUnblockDependents(rootChatId)
      }
    }
    if (task.status === 'running') startDriver(task)
    return task
  }

  function startDriver(task: SubagentTask): void {
    const controller = new AbortController()
    controllers.set(task.chatId, controller)

    setPhase(task.rootChatId, task.id, 'queued: waiting for capacity')
    const done = runTask(task.id, task.rootChatId, task.chatId, controller.signal)
      .catch((error) => {
        if (error instanceof TaskInterrupted) return
        deps.logger?.warn('subagent task failed', { chatId: task.chatId, error })
        failTask(task.rootChatId, task.id, error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (controllers.get(task.chatId) === controller) controllers.delete(task.chatId)
        if (driverDone.get(task.chatId) === done) driverDone.delete(task.chatId)
        maybeUnblockDependents(task.rootChatId)
      })
    driverDone.set(task.chatId, done)
  }

  function dependencyUnsatisfiable(task: SubagentTask): string | null {
    for (const depId of task.dependsOn) {
      const dep = deps.store.tasks.get(task.rootChatId, depId)
      if (dep && (dep.status === 'failed' || dep.status === 'cancelled')) return depId
      if (!dep) return depId
    }
    return null
  }

  function maybeUnblockDependents(rootChatId: string): void {
    for (const candidate of deps.store.tasks.listByRoot(rootChatId)) {
      if (candidate.status !== 'pending') continue
      const blocker = dependencyUnsatisfiable(candidate)
      if (blocker) {
        const blockerTask = deps.store.tasks.get(rootChatId, blocker)
        const reason = blockerTask?.result?.errorMessage ?? 'did not complete successfully'
        failDependency(
          rootChatId,
          candidate.id,
          blocker,
          `Dependency '${blocker}' failed: ${reason}`
        )
        continue
      }
      if (!dependenciesSatisfied(candidate)) continue
      const started = dispatch(rootChatId, candidate.id, { kind: 'start', now: Date.now() })
      if (started) startDriver(started)
    }
  }

  function failTask(rootChatId: string, taskId: string, message: string): void {
    dispatch(rootChatId, taskId, { kind: 'fail', message, now: Date.now() })
  }

  function failDependency(
    rootChatId: string,
    taskId: string,
    failedDependencyId: string,
    message: string
  ): void {
    dispatch(rootChatId, taskId, { kind: 'fail', message, failedDependencyId, now: Date.now() })
  }

  function setPhase(rootChatId: string, taskId: string, phase: string): void {
    dispatch(rootChatId, taskId, { kind: 'set-phase', phase, now: Date.now() })
  }

  function setPhaseByChat(chatId: string, phase: string): void {
    const task = deps.store.tasks.getByChat(chatId)
    if (task) setPhase(task.rootChatId, task.id, phase)
  }

  async function acquireRunSlots(
    rootChatId: string,
    chatId: string,
    signal: AbortSignal
  ): Promise<() => void> {
    let releaseRoot: () => void
    try {
      releaseRoot = await rootSlots.acquire(rootChatId, signal)
    } catch (error) {
      if (signal.aborted) throw new TaskInterrupted(chatId, 'cancelled')
      throw error
    }
    let releaseGlobal: () => void
    try {
      releaseGlobal = await backgroundSlots.acquire(signal)
    } catch (error) {
      releaseRoot()
      if (signal.aborted) throw new TaskInterrupted(chatId, 'cancelled')
      throw error
    }
    return () => {
      releaseGlobal()
      releaseRoot()
    }
  }

  async function runStreamPass(params: {
    chatId: string
    def: AgentDefinition
    messages: TanzoUIMessage[]
    depth: number
    runId: string
    signal: AbortSignal
    release: () => void
    onEpoch: (epoch: number) => void
  }): Promise<AgentStreamFinalState | undefined> {
    const { chatId, def, messages, depth, runId, signal, release, onEpoch } = params
    const progress = createSignalQueue()
    let finalState: AgentStreamFinalState | undefined
    const runPromise = callbacks
      .startChatRun({
        chatId,
        def,
        messages,
        depth,
        broadcast: true,
        runId,
        signal,
        onProgress: () => progress.signal(),
        // Derive live progress from the sub-agent's own step activity instead of
        // asking it to self-report: each tool it runs becomes its current phase.
        onTrace: (entry) => {
          if (entry.type === 'tool') setPhaseByChat(chatId, phaseLabel(entry.toolName))
        },
        onStart: (token) => onEpoch(token.epoch)
      })
      .finally(() => progress.close())
    try {
      while (await progress.next()) {
        // Stream progress is observed by the UI via run frames; the task row
        // is updated only on phase/approval/result transitions.
      }
      finalState = await runPromise
    } finally {
      release()
    }
    return finalState
  }

  async function runTask(
    taskId: string,
    rootChatId: string,
    chatId: string,
    signal: AbortSignal
  ): Promise<void> {
    const def = await deps.store.resolveAgentDefinition(chatId)
    let observedEpoch = callbacks.currentRunEpoch(chatId)

    for (;;) {
      if (signal.aborted) throw new TaskInterrupted(chatId, 'cancelled')
      if (callbacks.hasAdvancedSince(chatId, observedEpoch)) {
        throw new TaskInterrupted(chatId, 'superseded')
      }
      const depth = deps.store.depthOf(chatId)
      const runId = randomUUID()
      const messages = await collaborators.compaction.prepareMessages(
        chatId,
        def,
        await deps.store.load(chatId),
        runId,
        { signal }
      )

      const release = await acquireRunSlots(rootChatId, chatId, signal)
      const finalState = await runStreamPass({
        chatId,
        def,
        messages,
        depth,
        runId,
        signal,
        release,
        onEpoch: (epoch) => {
          observedEpoch = epoch
        }
      })

      if (callbacks.hasAdvancedSince(chatId, observedEpoch)) {
        throw new TaskInterrupted(chatId, 'superseded')
      }
      if (signal.aborted || finalState?.aborted) throw new TaskInterrupted(chatId, 'cancelled')

      if (finalState?.streamFailed) {
        failTask(rootChatId, taskId, finalState.streamError ?? 'Sub-agent stream failed.')
        return
      }

      if (finalState?.inlineCompaction) {
        try {
          const compacted = await collaborators.compaction.reconcileInline(
            chatId,
            def,
            finalState.inlineCompaction,
            { signal }
          )
          if (compacted) observedEpoch = callbacks.currentRunEpoch(chatId)
        } catch (error) {
          if (signal.aborted) throw new TaskInterrupted(chatId, 'cancelled')
          deps.logger?.warn('subagent task inline compaction reconcile failed', { chatId, error })
        }
      }

      const reloaded = await deps.store.load(chatId)
      const pending = extractPendingApprovals(reloaded)
      if (pending.length === 0) {
        completeTask(rootChatId, taskId, reloaded)
        return
      }

      const waits = pending.map((p) => waitApproval(p.approvalId, signal))
      surfaceApprovals(rootChatId, taskId, pending)
      await Promise.all(waits)
      clearApprovalBlock(rootChatId, taskId)
    }
  }

  function completeTask(rootChatId: string, taskId: string, messages: TanzoUIMessage[]): void {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task || isTerminal(task.status)) return

    // The deliverable is whatever the sub-agent's run naturally converged to:
    // its final assistant message, passed through verbatim. No separate "submit"
    // step and no confidence tiers — the last message is the answer.
    const summary = lastAssistantText(messages)

    if (summary.trim() === '') {
      dispatch(rootChatId, taskId, {
        kind: 'fail',
        message: 'Sub-agent finished without producing any final text.',
        failureKind: 'logic-error',
        now: Date.now()
      })
      return
    }
    dispatch(rootChatId, taskId, {
      kind: 'complete',
      summary,
      ...(task.notes.length > 0 ? { notes: task.notes } : {}),
      now: Date.now()
    })
  }

  function surfaceApprovals(
    rootChatId: string,
    taskId: string,
    pending: Array<{ approvalId: string; toolName: string; input: unknown }>
  ): void {
    const approvals: SubagentTaskApproval[] = pending.map((p) => ({
      approvalId: p.approvalId,
      toolName: p.toolName,
      input: p.input
    }))
    dispatch(rootChatId, taskId, { kind: 'surface-approvals', approvals })
  }

  function clearApprovalBlock(rootChatId: string, taskId: string): void {
    dispatch(rootChatId, taskId, { kind: 'clear-approval-block' })
  }

  function waitApproval(approvalId: string, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        approvalWaiters.delete(approvalId)
        resolve()
        return
      }
      const settle = (): void => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = (): void => {
        approvalWaiters.delete(approvalId)
        settle()
      }
      approvalWaiters.set(approvalId, settle)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  function listApprovals(rootChatId: string): SubagentTaskApprovalView[] {
    const out: SubagentTaskApprovalView[] = []
    for (const task of deps.store.tasks.listByRoot(rootChatId)) {
      if (task.block?.kind !== 'approval') continue
      for (const approval of task.block.approvals) {
        out.push({
          taskId: task.id,
          rootChatId: task.rootChatId,
          chatId: task.chatId,
          agentType: task.agentType,
          objective: task.objective,
          allowedTools: task.allowedTools,
          ...(task.phase ? { phase: task.phase } : {}),
          approval
        })
      }
    }
    return out
  }

  function findTaskByApproval(rootChatId: string, approvalId: string): SubagentTask | undefined {
    return deps.store.tasks
      .listByRoot(rootChatId)
      .find(
        (task) =>
          task.block?.kind === 'approval' &&
          task.block.approvals.some((a) => a.approvalId === approvalId)
      )
  }

  function enqueueApproval(chatId: string, fn: () => Promise<void>): Promise<void> {
    const previous = approvalChains.get(chatId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(fn)
    const tracked = next.finally(() => {
      if (approvalChains.get(chatId) === tracked) approvalChains.delete(chatId)
    })
    approvalChains.set(chatId, tracked)
    return next
  }

  async function respondApproval(
    rootChatId: string,
    response: SubagentTaskApprovalResponse
  ): Promise<void> {
    const task = findTaskByApproval(rootChatId, response.approvalId)
    if (!task) return
    await enqueueApproval(task.chatId, async () => {
      const messages = await deps.store.load(task.chatId)
      const denyReason =
        !response.approved && response.suggestion
          ? [response.reason, suggestionText(response.suggestion)].filter(Boolean).join(' ')
          : response.reason
      const {
        messages: next,
        toolName,
        input
      } = applyApprovalResponse(messages, response.approvalId, response.approved, denyReason)
      deps.store.save(task.chatId, next)
      if ((response.scope === 'session' || response.scope === 'forever') && toolName) {
        collaborators.policy.remember(
          {
            toolName,
            inputFingerprint: fingerprint(toolName, input, fingerprintFieldsFor(toolName)),
            decision: response.approved ? 'approved' : 'denied',
            scope: response.scope,
            decidedAt: Date.now()
          },
          task.chatId
        )
      }
      const resolve = approvalWaiters.get(response.approvalId)
      approvalWaiters.delete(response.approvalId)
      if (!resolve) {
        deps.logger?.warn('subagent approval response had no registered waiter', {
          approvalId: response.approvalId,
          chatId: task.chatId
        })
      }
      resolve?.()
    })
  }

  function suggestionText(suggestion: {
    kind: 'retry' | 'amend' | 'skip' | 'abort'
    detail?: string
  }): string {
    const base = {
      retry: 'Try a different approach.',
      amend: 'Adjust the command and retry.',
      skip: 'Skip this step and continue.',
      abort: 'Abort this objective.'
    }[suggestion.kind]
    return suggestion.detail ? `${base} ${suggestion.detail}` : base
  }

  function awaitTask(
    rootChatId: string,
    taskId: string,
    signal?: AbortSignal
  ): Promise<SubagentTaskResult> {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) {
      return Promise.resolve({ summary: '', failed: true, errorMessage: `Unknown task ${taskId}.` })
    }
    if (isTerminal(task.status)) {
      return Promise.resolve(resolveResult(task))
    }
    if (signal?.aborted) {
      return Promise.resolve({
        summary: '',
        failed: true,
        errorMessage: 'await cancelled.',
        failureKind: 'await-cancelled'
      })
    }
    const key = waiterKey(rootChatId, taskId)
    return new Promise<SubagentTaskResult>((resolve) => {
      const waiters = settleWaiters.get(key) ?? new Set<() => void>()
      const onSettle = (): void => {
        signal?.removeEventListener('abort', onAbort)
        const settled = deps.store.tasks.get(rootChatId, taskId)
        resolve(settled ? resolveResult(settled) : { summary: '', failed: true })
      }
      const onAbort = (): void => {
        waiters.delete(onSettle)
        if (waiters.size === 0) settleWaiters.delete(key)
        resolve({
          summary: '',
          failed: true,
          errorMessage: 'await cancelled.',
          failureKind: 'await-cancelled'
        })
      }
      waiters.add(onSettle)
      settleWaiters.set(key, waiters)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  function resolveResult(task: SubagentTask): SubagentTaskResult {
    if (task.result) return task.result
    if (task.status === 'cancelled') {
      return { summary: '', failed: true, errorMessage: 'Task cancelled.' }
    }
    return { summary: '' }
  }

  // Resolve when the task emits a note (soft wake) OR settles OR the wait is
  // aborted. Never rejects. The caller (await tool) re-checks task status to
  // decide whether this was a settle or a still-running note snapshot.
  function waitForNote(rootChatId: string, taskId: string, signal?: AbortSignal): Promise<void> {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task || isTerminal(task.status) || signal?.aborted) return Promise.resolve()
    const key = waiterKey(rootChatId, taskId)
    return new Promise<void>((resolve) => {
      const waiters = noteWaiters.get(key) ?? new Set<() => void>()
      const onWake = (): void => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = (): void => {
        waiters.delete(onWake)
        if (waiters.size === 0) noteWaiters.delete(key)
        resolve()
      }
      waiters.add(onWake)
      noteWaiters.set(key, waiters)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  function cancel(rootChatId: string, taskId: string): void {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task || isTerminal(task.status)) return
    controllers.get(task.chatId)?.abort()
    callbacks.abortRun(task.chatId)
    callbacks.clearTransientChatState(task.chatId)
    dispatch(rootChatId, taskId, { kind: 'cancel', now: Date.now() })

    cancelTree(task.chatId)
  }

  function steerGuard(task: SubagentTask | undefined): SteerTaskOutcome | null {
    if (!task) return { ok: false, reason: 'not-found' }
    if (isTerminal(task.status)) return { ok: false, reason: 'terminal' }
    if (task.block?.kind === 'dependency') return { ok: false, reason: 'dependency-blocked' }
    return null
  }

  async function instruct(
    rootChatId: string,
    taskId: string,
    instruction: string
  ): Promise<SteerTaskOutcome> {
    const task = deps.store.tasks.get(rootChatId, taskId)
    const rejected = steerGuard(task)
    if (rejected) return rejected
    const oldDone = driverDone.get(task!.chatId)
    controllers.get(task!.chatId)?.abort()
    callbacks.abortRun(task!.chatId)
    await oldDone
    const history = await deps.store.load(task!.chatId)
    deps.store.save(task!.chatId, [
      ...history,
      { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: instruction }] }
    ])
    const resumed = dispatch(rootChatId, taskId, { kind: 'resume', now: Date.now() })
    if (resumed?.status === 'running') startDriver(resumed)
    return { ok: true }
  }

  async function redefine(
    rootChatId: string,
    taskId: string,
    objective: string
  ): Promise<SteerTaskOutcome> {
    const task = deps.store.tasks.get(rootChatId, taskId)
    const rejected = steerGuard(task)
    if (rejected) return rejected
    const oldDone = driverDone.get(task!.chatId)
    controllers.get(task!.chatId)?.abort()
    callbacks.abortRun(task!.chatId)
    await oldDone
    writeObjective(task!.chatId, objective)
    const restarted = dispatch(rootChatId, taskId, { kind: 'redefine', objective, now: Date.now() })
    if (restarted?.status === 'running') startDriver(restarted)
    return { ok: true }
  }

  async function resumeByChat(chatId: string): Promise<void> {
    const task = deps.store.tasks.getByChat(chatId)
    if (!task || isTerminal(task.status)) return

    const oldDone = driverDone.get(task.chatId)
    controllers.get(task.chatId)?.abort()
    callbacks.abortRun(task.chatId)
    await oldDone
    const resumed = dispatch(task.rootChatId, task.id, { kind: 'resume', now: Date.now() })

    if (resumed?.status === 'running') startDriver(resumed)
  }

  function retry(rootChatId: string, taskId: string): void {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) return
    if (task.status !== 'failed' && task.status !== 'cancelled') return

    writeObjective(task.chatId, task.objective)
    const restarted = dispatch(rootChatId, taskId, { kind: 'retry', now: Date.now() })
    if (restarted) startDriver(restarted)

    cascadeRetryDependents(rootChatId, taskId)
  }

  function cascadeRetryDependents(rootChatId: string, retriedTaskId: string): void {
    for (const candidate of deps.store.tasks.listByRoot(rootChatId)) {
      if (candidate.status !== 'failed') continue
      if (!candidate.dependsOn.includes(retriedTaskId)) continue
      const causedByDep =
        candidate.result?.failedDependencyId === retriedTaskId ||
        (candidate.result?.failedDependencyId === undefined &&
          (candidate.result?.errorMessage?.includes(`'${retriedTaskId}'`) ?? false))
      if (!causedByDep) continue
      dispatch(rootChatId, candidate.id, {
        kind: 'reset-dependency',
        taskIds: candidate.dependsOn,
        now: Date.now()
      })
    }
  }

  function reconcileOrphans(): number {
    const orphans = deps.store.tasks.listUnsettled()
    for (const task of orphans) {
      if (controllers.has(task.chatId)) continue
      dispatch(task.rootChatId, task.id, {
        kind: 'fail',
        message: 'Interrupted: the app restarted while this sub-agent was running.',
        failureKind: 'app-restart',
        now: Date.now()
      })
    }
    return orphans.length
  }

  function cancelTree(chatId: string, visited = new Set<string>()): void {
    const isRoot = visited.size === 0
    if (visited.has(chatId)) return
    visited.add(chatId)
    const rootChatId = deps.store.rootOf(chatId)
    for (const task of deps.store.tasks.listByRoot(rootChatId)) {
      if (task.parentChatId === chatId || task.chatId === chatId) {
        controllers.get(task.chatId)?.abort()
        if (!isTerminal(task.status)) {
          dispatch(task.rootChatId, task.id, { kind: 'cancel', now: Date.now() })
        }
        cancelTree(task.chatId, visited)
      }
    }
    if (isRoot) {
      maybeUnblockDependents(rootChatId)
      broadcastTasks(rootChatId)
    }
  }

  return {
    spawn,
    await: awaitTask,
    get: (rootChatId, taskId) => deps.store.tasks.get(rootChatId, taskId),
    list: (rootChatId, status) => {
      const all = deps.store.tasks.listByRoot(rootChatId)
      return status ? all.filter((task) => task.status === status) : all
    },
    instruct,
    redefine,
    cancel,
    retry,
    resumeByChat,
    addNote: (chatId, note) => {
      const task = deps.store.tasks.getByChat(chatId)
      if (task) dispatch(task.rootChatId, task.id, { kind: 'add-note', note, now: Date.now() })
    },
    waitForNote,
    listApprovals,
    respondApproval,
    cancelTree,
    reconcileOrphans
  }
}
