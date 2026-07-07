import type { ContextSection } from '../section'
import type { ThreadGoal } from '@shared/goal'
import { pulseText } from '../../goal/templates'

export interface GoalSectionReader {
  get(chatId: string): ThreadGoal | null
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
      return pulseText(goal, goalInjection)
    }
  }
}
