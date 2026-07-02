import { tool, zodSchema, type Tool, type ToolSet } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { SubagentTaskResult } from '@shared/subagent-task'
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
        const spawned = tasks.map((spec) => {
          const task = deps.spawnTask({
            parentChatId,
            objective: spec.objective,
            agentType: spec.agent,
            ...(spec.dependsOn && spec.dependsOn.length > 0 ? { dependsOn: spec.dependsOn } : {})
          })
          return { task: task.id, status: task.status }
        })
        // Inline reminder so the agent has an immediate, concrete follow-up
        // action visible in the tool result — reduces the risk of forgetting await.
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

export function awaitTool(
  deps: ToolDeps,
  parentChatId: string
): Tool<TanzoTools['await']['input'], TanzoTools['await']['output']> {
  const rootChatId = deps.rootOf(parentChatId)
  return tool<TanzoTools['await']['input'], TanzoTools['await']['output'], Record<string, unknown>>(
    {
      description:
        'Wait for sub-agent tasks to finish and return their results. settle:"all" (default) ' +
        'waits for every listed task; settle:"first" returns as soon as one finishes. Pass ' +
        'timeoutMs to cap the wait — tasks keep running and can be awaited again. Use after spawn ' +
        'when you need the deliverable before continuing.',
      inputSchema: zodSchema(awaitInputSchema),
      outputSchema: zodSchema(awaitOutputSchema),
      metadata: { tanzo: { kind: 'read', component: 'SubagentCard' } },
      toModelOutput: toolResultToModelOutput,
      async execute({ tasks, settle = 'all', timeoutMs }, { abortSignal }) {
        const known = tasks.filter((id) => deps.getTask(rootChatId, id))
        if (known.length === 0) return toolError('No known tasks to await.')

        const settled = new Map<string, SubagentTaskResult>()
        let timedOut = false

        const collect = async (id: string): Promise<string> => {
          settled.set(id, await deps.awaitTask(rootChatId, id, abortSignal))
          return id
        }

        let timeoutTimer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<'timeout'>((resolve) => {
          if (timeoutMs === undefined) return
          timeoutTimer = setTimeout(() => resolve('timeout'), timeoutMs)
        })

        try {
          if (settle === 'first') {
            const winner = await Promise.race(
              timeoutMs === undefined ? known.map(collect) : [...known.map(collect), timeout]
            )
            if (winner === 'timeout') timedOut = true
          } else {
            const all = Promise.all(known.map(collect))
            if (timeoutMs === undefined) {
              await all
            } else {
              const race = await Promise.race([all.then(() => 'done' as const), timeout])
              if (race === 'timeout') timedOut = true
            }
          }
        } finally {
          // Always clear the timer: without this, every await call with a
          // timeoutMs leaks a pending setTimeout (up to 60min) after tasks
          // settle normally.
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
        }

        const results = known
          .filter((id) => settled.has(id))
          .map((id) => ({ task: id, result: settled.get(id)! }))
        const pending = known.filter((id) => !settled.has(id))
        return {
          results,
          ...(pending.length > 0 ? { pending } : {}),
          ...(timedOut ? { timedOut: true } : {})
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
        if (!deps.getTask(rootChatId, task)) return toolError(`Unknown task ${task}.`)
        if (objective && instruction) {
          return toolError('Provide either instruction or objective, not both.')
        }
        if (objective) {
          await deps.redefineTask(rootChatId, task, objective)
          return { steered: true, mode: 'redefined' }
        }
        if (instruction) {
          await deps.instructTask(rootChatId, task, instruction)
          return { steered: true, mode: 'instructed' }
        }
        return toolError('Provide an instruction to append or an objective to replace.')
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
