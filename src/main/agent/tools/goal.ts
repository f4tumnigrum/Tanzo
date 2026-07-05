import { tool, zodSchema, type Tool, type ToolSet } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import { BLOCK_ATTEMPTS_REQUIRED } from '../goal/goal.machine'
import type { ToolDeps } from './types'
import { toolResultToModelOutput } from './model-output'
import { updateGoalInputSchema } from './tool-schemas'

const UPDATE_DESC =
  'Update the existing goal status. Use "complete" only when the objective is achieved and no required ' +
  'work remains, proven by current evidence. Use "blocked" when you cannot make progress without user ' +
  `input or an external change — it takes effect only after ${BLOCK_ATTEMPTS_REQUIRED} recorded attempts ` +
  'across turns with no work in between; earlier calls record the blocker and you should keep trying ' +
  'alternate approaches. This tool cannot pause, resume, or budget-limit a goal.'

export function updateGoalTool(
  deps: ToolDeps,
  chatId: string,
  runId?: string
): Tool<TanzoTools['updateGoal']['input'], TanzoTools['updateGoal']['output']> {
  return tool<
    TanzoTools['updateGoal']['input'],
    TanzoTools['updateGoal']['output'],
    Record<string, unknown>
  >({
    description: UPDATE_DESC,
    inputSchema: zodSchema(updateGoalInputSchema),
    metadata: { tanzo: { kind: 'exec', component: 'GoalCard' } },
    toModelOutput: toolResultToModelOutput,
    async execute({ status }) {
      const result = deps.goal.markOutcome(chatId, status, runId !== undefined ? { runId } : {})
      if (result.kind === 'no-goal') {
        return { error: true, message: 'No goal exists for this conversation.' }
      }
      if (result.kind === 'rejected') {
        return {
          recorded: true,
          attempts: result.attempts,
          required: result.required,
          message:
            `Blocker recorded (${result.attempts}/${result.required}). "blocked" takes effect ` +
            `only after ${result.required} recorded attempts with no work in between — keep ` +
            'trying alternate approaches this turn.'
        }
      }
      return { updated: true, status }
    }
  }) as Tool<TanzoTools['updateGoal']['input'], TanzoTools['updateGoal']['output']>
}

export function goalTools(deps: ToolDeps, chatId: string, runId?: string): ToolSet {
  return {
    updateGoal: updateGoalTool(deps, chatId, runId)
  }
}
