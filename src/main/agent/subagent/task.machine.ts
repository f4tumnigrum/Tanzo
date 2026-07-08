import type { SubagentTask, SubagentTaskApproval, SubagentTaskNote } from '@shared/subagent-task'
import { next, stay, type Transition } from '../runtime/machine/types'

export const TASK_TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled'] as const)

export function isTaskTerminal(status: SubagentTask['status']): boolean {
  return TASK_TERMINAL_STATUSES.has(status as 'done' | 'failed' | 'cancelled')
}

export type TaskEvent =
  | { kind: 'start'; now: number }
  | {
      kind: 'fail'
      message: string
      failureKind?: 'app-restart' | 'logic-error'

      failedDependencyId?: string
      now: number
    }
  | {
      kind: 'complete'
      summary: string
      notes?: SubagentTaskNote[]
      now: number
    }
  | { kind: 'surface-approvals'; approvals: SubagentTaskApproval[] }
  | { kind: 'clear-approval-block' }
  | { kind: 'cancel'; now: number }
  | { kind: 'resume'; now: number }
  | { kind: 'redefine'; objective: string; now: number }
  | { kind: 'retry'; now: number }
  | { kind: 'set-phase'; phase: string; now: number }
  | { kind: 'add-note'; note: string; now: number }
  /** Reset a failed/cancelled task back to pending-with-dependency-block so that
   *  when its dependencies complete it can start automatically (used by cascadeRetry). */
  | { kind: 'reset-dependency'; taskIds: string[]; now: number }

export type TaskEffect = { kind: 'persist' } | { kind: 'notify-settled' } | { kind: 'wake-note' }

const PERSIST: readonly TaskEffect[] = [{ kind: 'persist' }]
const PERSIST_AND_SETTLE: readonly TaskEffect[] = [{ kind: 'persist' }, { kind: 'notify-settled' }]
const PERSIST_AND_WAKE: readonly TaskEffect[] = [{ kind: 'persist' }, { kind: 'wake-note' }]

function withoutBlock(task: SubagentTask): SubagentTask {
  const rest = { ...task }
  delete rest.block
  return rest
}

export function taskTransition(
  task: SubagentTask,
  event: TaskEvent
): Transition<SubagentTask, TaskEffect> {
  switch (event.kind) {
    case 'start':
      return next({ ...withoutBlock(task), status: 'running', startedAt: event.now }, PERSIST)

    case 'fail': {
      if (isTaskTerminal(task.status)) return stay(task)
      return next(
        {
          ...withoutBlock(task),
          status: 'failed',
          completedAt: event.now,
          result: {
            summary: '',
            failed: true,
            errorMessage: event.message,
            ...(event.failureKind ? { failureKind: event.failureKind } : {}),
            ...(event.failedDependencyId ? { failedDependencyId: event.failedDependencyId } : {})
          }
        },
        PERSIST_AND_SETTLE
      )
    }

    case 'complete': {
      if (isTaskTerminal(task.status)) return stay(task)
      const done: SubagentTask = {
        ...withoutBlock(task),
        status: 'done',
        completedAt: event.now,
        result: {
          summary: event.summary,
          ...(event.notes && event.notes.length > 0 ? { notes: event.notes } : {})
        }
      }
      delete done.phase
      return next(done, PERSIST_AND_SETTLE)
    }

    case 'surface-approvals':
      return next(
        { ...task, status: 'blocked', block: { kind: 'approval', approvals: event.approvals } },
        PERSIST
      )

    case 'clear-approval-block':
      if (task.block?.kind !== 'approval') return stay(task)
      return next({ ...withoutBlock(task), status: 'running' }, PERSIST)

    case 'cancel': {
      if (isTaskTerminal(task.status)) return stay(task)
      return next(
        { ...withoutBlock(task), status: 'cancelled', completedAt: event.now },
        PERSIST_AND_SETTLE
      )
    }

    case 'resume':
      if (isTaskTerminal(task.status)) return stay(task)
      if (task.block?.kind === 'dependency') return stay(task)
      return next(
        {
          ...withoutBlock(task),
          status: 'running',
          startedAt: task.startedAt ?? event.now
        },
        PERSIST
      )

    case 'redefine': {
      if (isTaskTerminal(task.status)) return stay(task)
      const restarted: SubagentTask = {
        ...withoutBlock(task),
        objective: event.objective,
        status: 'running',
        startedAt: event.now,
        phases: [],
        notes: []
      }
      delete restarted.phase
      delete restarted.result
      return next(restarted, PERSIST)
    }

    case 'retry': {
      if (task.status !== 'failed' && task.status !== 'cancelled') return stay(task)
      const restarted: SubagentTask = {
        ...withoutBlock(task),
        status: 'running',
        startedAt: event.now,
        phases: [],
        notes: []
      }
      delete restarted.phase
      delete restarted.result
      return next(restarted, PERSIST)
    }

    case 'set-phase':
      if (isTaskTerminal(task.status)) return stay(task)
      return next(
        {
          ...task,
          phase: event.phase,
          phases: [...task.phases, { name: event.phase, at: event.now }]
        },
        PERSIST
      )

    case 'add-note':
      if (isTaskTerminal(task.status)) return stay(task)
      return next(
        { ...task, notes: [...task.notes, { text: event.note, at: event.now }] },
        PERSIST_AND_WAKE
      )

    case 'reset-dependency': {
      if (task.status !== 'failed' && task.status !== 'cancelled') return stay(task)

      const reset: SubagentTask = {
        ...withoutBlock(task),
        status: 'pending',
        block: { kind: 'dependency', taskIds: event.taskIds },
        phases: [],
        notes: []
      }
      delete reset.result
      delete reset.phase
      delete reset.completedAt
      return next(reset, PERSIST)
    }

    default:
      return stay(task)
  }
}
