import { tool, zodSchema, type Tool, type ToolSet } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type {
  SubagentTask,
  SubagentTaskPendingView,
  SubagentTaskResult
} from '@shared/subagent-task'
import type { ToolDeps } from './types'
import { toolResultToModelOutput } from './model-output'
import { toolError } from './builtin/shared'
import {
  awaitInputSchema,
  awaitOutputSchema,
  cancelTaskInputSchema,
  cancelTaskOutputSchema,
  spawnInputSchema,
  spawnOutputSchema,
  steerInputSchema,
  steerOutputSchema,
  tasksInputSchema,
  tasksOutputSchema
} from './tool-schemas'

export interface SubagentType {
  name: string
  description: string
  readOnly: boolean
  available: boolean
  unavailableReason?: string
}

function catalogText(agentTypes: SubagentType[]): string {
  return agentTypes
    .map((a) => {
      const note = a.available ? '' : ` (unavailable: ${a.unavailableReason ?? 'restricted'})`
      return a.description ? `- ${a.name}: ${a.description}${note}` : `- ${a.name}${note}`
    })
    .join('\n')
}

export function spawnTool(
  deps: ToolDeps,
  parentChatId: string,
  agentTypes: SubagentType[]
): Tool<TanzoTools['spawn']['input'], TanzoTools['spawn']['output']> {
  const available = agentTypes.filter((a) => a.available).map((a) => a.name)
  return tool<TanzoTools['spawn']['input'], TanzoTools['spawn']['output'], Record<string, unknown>>(
    {
      description:
        'Spawn one or more sub-agent tasks. Returns immediately with readable task ids (e.g. ' +
        '"explore-1"); tasks run concurrently. Put independent work in a single call so it runs ' +
        'in parallel, then collect results with await. Declare dependsOn to gate a task on ' +
        'earlier ones.\n' +
        `Available sub-agent types:\n${catalogText(agentTypes)}`,
      inputSchema: zodSchema(spawnInputSchema),
      outputSchema: zodSchema(spawnOutputSchema),
      metadata: { tanzo: { kind: 'exec', component: 'SubagentCard' } },
      toModelOutput: toolResultToModelOutput,
      execute({ tasks }) {
        for (const spec of tasks) {
          const resolved = deps.resolveAgentType(spec.agent)
          if (!resolved || resolved.kind !== 'subagent') {
            return toolError(
              `Unknown sub-agent type "${spec.agent}". Use one of: ${available.join(', ')}.`
            )
          }
          if (!available.includes(spec.agent)) {
            const meta = agentTypes.find((a) => a.name === spec.agent)
            return toolError(
              `Sub-agent "${spec.agent}" is unavailable here${
                meta?.unavailableReason ? `: ${meta.unavailableReason}` : ''
              }. Available: ${available.join(', ')}.`
            )
          }
        }
        const spawned: Array<{ task: string; status: SubagentTask['status'] }> = []
        for (const [index, spec] of tasks.entries()) {
          try {
            const task = deps.spawnTask({
              parentChatId,
              objective: spec.objective,
              agentType: spec.agent,
              ...(spec.dependsOn && spec.dependsOn.length > 0 ? { dependsOn: spec.dependsOn } : {})
            })
            spawned.push({ task: task.id, status: task.status })
          } catch (error) {
            const startedIds = spawned.map((t) => t.task)
            const detail = error instanceof Error ? error.message : String(error)
            return toolError(
              startedIds.length > 0
                ? `Spawned [${startedIds.join(', ')}] before failing on spec ${index + 1} ` +
                    `(${spec.agent}): ${detail} Those tasks are running — await or cancel them.`
                : `Failed to spawn spec ${index + 1} (${spec.agent}): ${detail}`
            )
          }
        }

        const ids = spawned.map((t) => JSON.stringify(t.task)).join(', ')
        const count = spawned.length
        const hint =
          `${count} task${count !== 1 ? 's' : ''} started. ` +
          `Collect results with: await({tasks:[${ids}]})`
        return { tasks: spawned, hint }
      }
    }
  )
}

function pendingView(id: string, task: SubagentTask | undefined): SubagentTaskPendingView {
  if (!task) return { task: id, status: 'running', updatedAt: Date.now() }
  const notes = task.notes ?? []
  const phases = task.phases ?? []
  const latestNote = notes.length > 0 ? notes[notes.length - 1] : undefined
  const latestPhase = phases.length > 0 ? phases[phases.length - 1] : undefined
  return {
    task: id,
    status: task.status,
    ...(task.phase ? { phase: task.phase } : {}),
    ...(latestNote ? { latestNote: latestNote.text } : {}),
    updatedAt: Math.max(latestPhase?.at ?? 0, latestNote?.at ?? 0, task.startedAt ?? task.createdAt)
  }
}

export function awaitTool(
  deps: ToolDeps,
  parentChatId: string
): Tool<TanzoTools['await']['input'], TanzoTools['await']['output']> {
  const rootChatId = deps.rootOf(parentChatId)
  return tool<TanzoTools['await']['input'], TanzoTools['await']['output'], Record<string, unknown>>(
    {
      description:
        'Wait for sub-agent tasks to finish and return their results. settle:"all" (default) ' +
        'waits for every listed task; settle:"first" returns as soon as one finishes. A task ' +
        'result is the final message that sub-agent produced when its work converged — use it ' +
        'as-is. You do not have to poll: if an awaited task sends a note mid-task, this returns ' +
        "early, and 'notedTasks' lists exactly which awaited tasks produced a new note this call " +
        "— read each one's latestNote in 'pending' (or its result if it also finished), then keep " +
        'waiting (await again), steer, or stop. Pass timeoutMs only as a safety cap; on timeout ' +
        "'pending' carries each unfinished task's status, phase, and latest note. Ids " +
        "that do not exist are listed in 'unknown' — check it whenever a result seems missing. A " +
        "failed result's failureKind tells you why: 'app-restart' (interrupted; retry or " +
        "respawn), 'await-cancelled' (your wait was aborted — the task may still be running), " +
        'otherwise a genuine task failure.',
      inputSchema: zodSchema(awaitInputSchema),
      outputSchema: zodSchema(awaitOutputSchema),
      metadata: { tanzo: { kind: 'read', component: 'SubagentCard' } },
      toModelOutput: toolResultToModelOutput,
      async execute({ tasks, settle = 'all', timeoutMs }, { abortSignal }) {
        const known = tasks.filter((id) => deps.getTask(rootChatId, id))
        const unknown = tasks.filter((id) => !deps.getTask(rootChatId, id))
        if (known.length === 0) {
          return toolError(
            `No known tasks to await. Unknown ids: ${unknown.join(', ')}. ` +
              'Use the exact ids returned by spawn.'
          )
        }

        const settled = new Map<string, SubagentTaskResult>()
        let timedOut = false

        // Baseline note counts per task at the start of this wait. Comparing
        // against these afterward tells us exactly which awaited tasks produced a
        // new note during the wait — independent of whether the wait ended by note
        // wake, settle, or timeout. This survives the "settle and note in the same
        // pass" race that a single boolean could not represent.
        const noteBaseline = new Map<string, number>()
        for (const id of known)
          noteBaseline.set(id, (deps.getTask(rootChatId, id)?.notes ?? []).length)

        // Scope every waiter registered this pass to a local controller so that
        // when we return early (note/timeout) the abandoned settle/note waiters
        // detach instead of piling up across repeated awaits on a long task.
        const waitController = new AbortController()
        if (abortSignal) {
          if (abortSignal.aborted) waitController.abort()
          else abortSignal.addEventListener('abort', () => waitController.abort(), { once: true })
        }
        const waitSignal = waitController.signal

        const collect = async (id: string): Promise<'settled'> => {
          settled.set(id, await deps.awaitTask(rootChatId, id, waitSignal))
          return 'settled'
        }

        // A mid-task note from any awaited task wakes the wait early so the parent
        // can react. This resolves on note, settle, or abort; which tasks actually
        // produced a note is computed afterward from noteBaseline, not from who
        // won this race.
        const noteWake = Promise.race(
          known.map((id) => deps.waitForNoteTask(rootChatId, id, waitSignal))
        ).then(() => 'note' as const)

        let timeoutTimer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<'timeout'>((resolve) => {
          if (timeoutMs === undefined) return
          timeoutTimer = setTimeout(() => resolve('timeout'), timeoutMs)
        })

        try {
          const done =
            settle === 'first'
              ? Promise.race(known.map(collect))
              : Promise.all(known.map(collect)).then(() => 'settled' as const)
          const racers: Array<Promise<'settled' | 'note' | 'timeout'>> = [done, noteWake]
          if (timeoutMs !== undefined) racers.push(timeout)
          const winner = await Promise.race(racers)
          if (winner === 'timeout') timedOut = true
        } finally {
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
          waitController.abort()
        }

        // Which awaited tasks produced a new note during this wait, in the input
        // order the parent passed. Precise per-task signal for the multi-task case;
        // for a single task it collapses to a one-element list.
        const notedTasks = known.filter(
          (id) => (deps.getTask(rootChatId, id)?.notes ?? []).length > (noteBaseline.get(id) ?? 0)
        )

        const results = known
          .filter((id) => settled.has(id))
          .map((id) => ({ task: id, result: settled.get(id)! }))
        const pending = known
          .filter((id) => !settled.has(id))
          .map((id) => pendingView(id, deps.getTask(rootChatId, id)))
        return {
          results,
          ...(pending.length > 0 ? { pending } : {}),
          ...(unknown.length > 0 ? { unknown } : {}),
          ...(timedOut ? { timedOut: true } : {}),
          ...(notedTasks.length > 0 ? { notedTasks } : {})
        }
      }
    }
  )
}

export function tasksTool(
  deps: ToolDeps,
  parentChatId: string
): Tool<TanzoTools['tasks']['input'], TanzoTools['tasks']['output']> {
  const rootChatId = deps.rootOf(parentChatId)
  return tool<TanzoTools['tasks']['input'], TanzoTools['tasks']['output'], Record<string, unknown>>(
    {
      description:
        'Inspect sub-agent tasks without blocking. Pass task to get one task (status, phase, ' +
        'blocking reason, result); omit it to list all tasks, optionally filtered by status.',
      inputSchema: zodSchema(tasksInputSchema),
      outputSchema: zodSchema(tasksOutputSchema),
      metadata: { tanzo: { kind: 'read', component: 'SubagentCard' } },
      toModelOutput: toolResultToModelOutput,
      execute({ task, status }) {
        if (task) {
          const found = deps.getTask(rootChatId, task)
          if (!found) return toolError(`Unknown task ${task}.`)
          return { tasks: [found] }
        }
        return { tasks: deps.listTasks(rootChatId, status) }
      }
    }
  )
}

export function steerTool(
  deps: ToolDeps,
  parentChatId: string
): Tool<TanzoTools['steer']['input'], TanzoTools['steer']['output']> {
  const rootChatId = deps.rootOf(parentChatId)
  return tool<TanzoTools['steer']['input'], TanzoTools['steer']['output'], Record<string, unknown>>(
    {
      description:
        'Adjust a running sub-agent task. Pass instruction to append guidance without ' +
        'restarting, or objective to replace the goal and restart from scratch. Provide exactly ' +
        'one of the two.',
      inputSchema: zodSchema(steerInputSchema),
      outputSchema: zodSchema(steerOutputSchema),
      metadata: { tanzo: { kind: 'exec', component: 'SubagentCard' } },
      toModelOutput: toolResultToModelOutput,
      async execute({ task, instruction, objective }) {
        const found = deps.getTask(rootChatId, task)
        if (!found) return toolError(`Unknown task ${task}.`)
        if (objective && instruction) {
          return toolError('Provide either instruction or objective, not both.')
        }
        if (!objective && !instruction) {
          return toolError('Provide an instruction to append or an objective to replace.')
        }
        const outcome = objective
          ? await deps.redefineTask(rootChatId, task, objective)
          : await deps.instructTask(rootChatId, task, instruction!)
        if (!outcome.ok) {
          switch (outcome.reason) {
            case 'terminal':
              return toolError(
                `Task '${task}' already settled (${found.status}). Its result is final; ` +
                  'spawn a new task and reference the old result in the objective.'
              )
            case 'dependency-blocked':
              return toolError(
                `Task '${task}' has not started (blocked on [${
                  found.block?.kind === 'dependency' ? found.block.taskIds.join(', ') : ''
                }]). Steer it after its dependencies complete, or cancel and respawn.`
              )
            default:
              return toolError(`Unknown task ${task}.`)
          }
        }
        return { steered: true, mode: objective ? 'redefined' : 'instructed' }
      }
    }
  )
}

export function cancelTaskTool(
  deps: ToolDeps,
  parentChatId: string
): Tool<TanzoTools['cancel']['input'], TanzoTools['cancel']['output']> {
  const rootChatId = deps.rootOf(parentChatId)
  return tool<
    TanzoTools['cancel']['input'],
    TanzoTools['cancel']['output'],
    Record<string, unknown>
  >({
    description: 'Cancel a sub-agent task whose result is no longer needed.',
    inputSchema: zodSchema(cancelTaskInputSchema),
    outputSchema: zodSchema(cancelTaskOutputSchema),
    metadata: { tanzo: { kind: 'exec', component: 'SubagentCard' } },
    toModelOutput: toolResultToModelOutput,
    execute({ task }) {
      if (!deps.getTask(rootChatId, task)) return toolError(`Unknown task ${task}.`)
      deps.cancelTask(rootChatId, task)
      return { cancelled: true }
    }
  })
}

export function subagentTools(
  deps: ToolDeps,
  parentChatId: string,
  agentTypes: SubagentType[]
): ToolSet {
  return {
    spawn: spawnTool(deps, parentChatId, agentTypes),
    await: awaitTool(deps, parentChatId),
    tasks: tasksTool(deps, parentChatId),
    steer: steerTool(deps, parentChatId),
    cancel: cancelTaskTool(deps, parentChatId)
  }
}
