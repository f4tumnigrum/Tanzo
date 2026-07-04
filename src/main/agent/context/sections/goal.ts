import type { ContextSection } from '../section'
import type { ThreadGoal } from '@shared/goal'
import { budgetLimitPrompt, continuationPrompt, objectiveUpdatedPrompt } from '../../goal/templates'

export interface GoalSectionReader {
  get(chatId: string): ThreadGoal | null
  peekInjection(chatId: string): ThreadGoal['pendingInjection']
  takeInjection(chatId: string): ThreadGoal['pendingInjection']
}

export function createGoalSection(reader: GoalSectionReader): ContextSection {
  return {
    id: 'goal',
    stability: 'volatile',
    channel: 'injection',
    order: 5,
    render: ({ chatId, goalInjection }) => {
      if (!goalInjection) return null
      const goal = reader.get(chatId)
      if (!goal) return null
      if (goalInjection === 'budget_limit') return budgetLimitPrompt(goal)
      if (goalInjection === 'objective_updated') return objectiveUpdatedPrompt(goal)
      return continuationPrompt(goal)
    }
  }
}
