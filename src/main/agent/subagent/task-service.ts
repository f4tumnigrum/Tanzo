import { randomUUID } from 'crypto'
import type { TanzoUIMessage } from '@shared/agent-message'
import type {
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

// Global ceiling across every conversation, so the process never runs an
// unbounded number of sub-agent streams at once.
const MAX_CONCURRENT_BACKGROUND = 100
// Per-root cap, so one conversation cannot occupy every global slot and starve
// the others. Each root (top-level chat) gets its own pool of this size.
const MAX_CONCURRENT_PER_ROOT = 20

/**
 * Thrown to unwind a task driver when its run is no longer current. `reason`
 * is diagnostic only: the catch site (see runTask spawn wiring) treats
 * 'cancelled' and 'superseded' identically — both silently unwind without
 * marking the task failed. The distinction reflects *why* the run stopped
 * (explicit cancel vs. a newer run taking the epoch) but does not drive control
 * flow, so the abort-vs-supersede ordering does not affect terminal status.
 */
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
  instruct(rootChatId: string, taskId: string, instruction: string): Promise<void>
  redefine(rootChatId: string, taskId: string, objective: string): Promise<void>
  cancel(rootChatId: string, taskId: string): void
  retry(rootChatId: string, taskId: string): void
  resumeByChat(chatId: string): Promise<void>
  reportPhase(chatId: string, phase: string): void
  submitResult(chatId: string, result: SubagentTaskResult): void
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

export function createTaskService(
  deps: AgentRuntimeDeps & { logger?: Logger },
  collaborators: { compaction: CompactionCoordinator; policy: PolicyEngine },
  callbacks: TaskRuntimeCallbacks
): TaskService {
  const backgroundSlots = createSemaphore(MAX_CONCURRENT_BACKGROUND)
  const rootSlots = createKeyedSemaphores(MAX_CONCURRENT_PER_ROOT)
  const controllers = new Map<string, AbortController>()
  // Tracks the Promise for each running driver so instruct/redefine can await
  // the old driver's full teardown before starting a new one, preventing two
  // concurrent drivers writing to the same chat simultaneously.
  const driverDone = new Map<string, Promise<void>>()
  const settleWaiters = new Map<string, Set<() => void>>()
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

  const isTerminal = isTaskTerminal

  /**
   * Interpreter shell for the task state machine: run the pure transition, then
   * apply its effects (persist + broadcast, notify awaiters). Returns the next
   * task object, or null when the task is gone.
   */
  function dispatch(rootChatId: string, taskId: string, event: TaskEvent): SubagentTask | null {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) return null
    const result = taskTransition(task, event)
    if (result.state === task && result.effects.length === 0) return task
    for (const effect of result.effects) {
      if (effect.kind === 'persist') persist(result.state)
      else if (effect.kind === 'notify-settled') notifySettled(rootChatId, taskId)
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
    let task!: SubagentTask
    deps.store.transaction(() => {
      const chatId = createExecutorConversation(input.parentChatId, input.agentType)
      writeObjective(chatId, input.objective)
      const id = readableId(rootChatId, input.agentType)
      const dependsOn = input.dependsOn ?? []
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
      // Self-dependency can never be satisfied (the task would wait on its own
      // completion forever) and is invisible to dependencyUnsatisfiable, which
      // finds the freshly inserted row in a non-terminal state. Fail fast.
      if (task.dependsOn.includes(task.id)) {
        failTask(
          rootChatId,
          task.id,
          `Task '${task.id}' cannot depend on itself; dependsOn must reference other, already-spawned task ids.`
        )
      } else {
        const blocker = dependencyUnsatisfiable(task)
        if (blocker) {
          const dep = deps.store.tasks.get(rootChatId, blocker)
          // Quote the dependency id so cascadeRetryDependents can trace this
          // failure back to the dep (it matches on `'${depId}'`).
          failTask(
            rootChatId,
            task.id,
            dep
              ? `Dependency '${blocker}' failed: ${dep.result?.errorMessage ?? 'did not complete successfully'}`
              : `Dependency '${blocker}' not found; dependsOn must reference already-spawned task ids.`
          )
        }
      }
    }
    if (task.status === 'running') startDriver(task)
    return task
  }

  function startDriver(task: SubagentTask): void {
    const controller = new AbortController()
    controllers.set(task.chatId, controller)
    // Mark the task as "queued" immediately so the agent and UI can tell the
    // difference between "waiting for a semaphore slot" and "actively running".
    // The first report() call from the sub-agent will overwrite this phase.
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
        // Propagate the root-cause error message so the parent agent can diagnose
        // without needing to inspect the dependency task separately.
        const blockerTask = deps.store.tasks.get(rootChatId, blocker)
        const reason = blockerTask?.result?.errorMessage ?? 'did not complete successfully'
        failTask(rootChatId, candidate.id, `Dependency '${blocker}' failed: ${reason}`)
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

  function setPhase(rootChatId: string, taskId: string, phase: string): void {
    dispatch(rootChatId, taskId, { kind: 'set-phase', phase, now: Date.now() })
  }

  /**
   * Acquire the per-root slot before the global one: this bounds each
   * conversation's share and avoids holding a scarce global slot while queued
   * behind a busy root. Returns a single `release` that frees both in reverse
   * order. On abort during either acquire, rolls back any slot already held and
   * throws TaskInterrupted so the caller treats it as a cancellation.
   */
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

  /**
   * Run a single stream pass while holding the concurrency slots, draining the
   * progress queue until the run settles. Slots are always released in the
   * finally. `onEpoch` is called if the underlying run reports a new epoch on
   * start, so the caller can keep its supersede check current.
   */
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

      // Reconcile an in-stream compaction against the persisted transcript.
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
      surfaceApprovals(rootChatId, taskId, pending)
      await Promise.all(pending.map((p) => waitApproval(p.approvalId, signal)))
      clearApprovalBlock(rootChatId, taskId)
    }
  }

  function completeTask(rootChatId: string, taskId: string, messages: TanzoUIMessage[]): void {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task || isTerminal(task.status)) return
    // Prefer an explicitly submitted result; fall back to the last assistant text.
    // Track which path was used so the parent and UI can gauge result confidence.
    const hasExplicitResult = Boolean(task.result && !task.result.failed)
    const summary = hasExplicitResult ? task.result!.summary : lastAssistantText(messages)
    const resultSource: 'explicit' | 'inferred' = hasExplicitResult ? 'explicit' : 'inferred'
    dispatch(rootChatId, taskId, { kind: 'complete', summary, resultSource, now: Date.now() })
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
      return Promise.resolve({ summary: '', failed: true, errorMessage: 'await cancelled.' })
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
        resolve({ summary: '', failed: true, errorMessage: 'await cancelled.' })
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

  function cancel(rootChatId: string, taskId: string): void {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task || isTerminal(task.status)) return
    controllers.get(task.chatId)?.abort()
    callbacks.abortRun(task.chatId)
    callbacks.clearTransientChatState(task.chatId)
    dispatch(rootChatId, taskId, { kind: 'cancel', now: Date.now() })
    cancelTree(task.chatId)
  }

  async function instruct(rootChatId: string, taskId: string, instruction: string): Promise<void> {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) return
    const oldDone = driverDone.get(task.chatId)
    controllers.get(task.chatId)?.abort()
    callbacks.abortRun(task.chatId)
    await oldDone
    const history = await deps.store.load(task.chatId)
    deps.store.save(task.chatId, [
      ...history,
      { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: instruction }] }
    ])
    const resumed = dispatch(rootChatId, taskId, { kind: 'resume', now: Date.now() })
    if (resumed) startDriver(resumed)
  }

  async function redefine(rootChatId: string, taskId: string, objective: string): Promise<void> {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) return
    const oldDone = driverDone.get(task.chatId)
    controllers.get(task.chatId)?.abort()
    callbacks.abortRun(task.chatId)
    await oldDone
    writeObjective(task.chatId, objective)
    const restarted = dispatch(rootChatId, taskId, { kind: 'redefine', objective, now: Date.now() })
    if (restarted) startDriver(restarted)
  }

  async function resumeByChat(chatId: string): Promise<void> {
    const task = deps.store.tasks.getByChat(chatId)
    if (!task || isTerminal(task.status)) return
    // Await the old driver's teardown before starting a new one, matching
    // instruct/redefine. Without this, aborting the controller and immediately
    // dispatching a resume can overlap two drivers writing the same chat.
    const oldDone = driverDone.get(task.chatId)
    controllers.get(task.chatId)?.abort()
    callbacks.abortRun(task.chatId)
    await oldDone
    const resumed = dispatch(task.rootChatId, task.id, { kind: 'resume', now: Date.now() })
    if (resumed) startDriver(resumed)
  }

  function retry(rootChatId: string, taskId: string): void {
    const task = deps.store.tasks.get(rootChatId, taskId)
    if (!task) return
    if (task.status !== 'failed' && task.status !== 'cancelled') return
    // No teardown await needed: retry only runs from a terminal (failed/cancelled)
    // state, so the prior driver has already settled and driverDone is cleared.
    writeObjective(task.chatId, task.objective)
    const restarted = dispatch(rootChatId, taskId, { kind: 'retry', now: Date.now() })
    if (restarted) startDriver(restarted)
    // Cascade: reset any tasks that failed *because* this dep failed, so they can
    // restart automatically when this task completes (via maybeUnblockDependents).
    cascadeRetryDependents(rootChatId, taskId)
  }

  /**
   * When a dependency is retried, find all tasks that failed because of it and
   * reset them back to pending-blocked so they auto-start once the dep finishes.
   * Only tasks whose errorMessage references the retried dep are touched; failures
   * with independent root causes are left alone.
   */
  function cascadeRetryDependents(rootChatId: string, retriedTaskId: string): void {
    for (const candidate of deps.store.tasks.listByRoot(rootChatId)) {
      if (candidate.status !== 'failed') continue
      if (!candidate.dependsOn.includes(retriedTaskId)) continue
      // Guard: only cascade if the failure message traces back to this specific dep.
      if (!candidate.result?.errorMessage?.includes(`'${retriedTaskId}'`)) continue
      dispatch(rootChatId, candidate.id, {
        kind: 'reset-dependency',
        taskIds: candidate.dependsOn,
        now: Date.now()
      })
    }
  }

  /**
   * On process start, tasks persisted as pending/running/blocked have no live
   * driver behind them — the in-memory run loop and AbortControllers died with
   * the previous process. Mark them failed so the UI stops showing a spinner and
   * any future await resolves instead of hanging forever. Called once at startup,
   * before any new run can attach.
   *
   * Uses failureKind:'app-restart' so the UI can distinguish these from genuine
   * logic failures and offer targeted "retry interrupted tasks" recovery.
   */
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
    broadcastTasks(rootChatId)
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
    reportPhase: (chatId, phase) => {
      const task = deps.store.tasks.getByChat(chatId)
      if (task) setPhase(task.rootChatId, task.id, phase)
    },
    submitResult: (chatId, result) => {
      const task = deps.store.tasks.getByChat(chatId)
      if (!task) return
      dispatch(task.rootChatId, task.id, { kind: 'set-result', result })
    },
    listApprovals,
    respondApproval,
    cancelTree,
    reconcileOrphans
  }
}
