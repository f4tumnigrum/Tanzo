import type { ContextSection } from '../section'
import type { ThreadGoal } from '@shared/goal'
import { deriveStatus } from '@shared/goal'
import { charterText } from '../../goal/templates'

export interface GoalCharterReader {
  get(chatId: string): ThreadGoal | null
}

export function createGoalCharterSection(reader: GoalCharterReader): ContextSection {
  return {
    id: 'goal-charter',
    stability: 'stable',
    channel: 'system',
    order: 40,
    render: ({ def, chatId }) => {
      if (def.kind !== 'main') return null
      const goal = reader.get(chatId)
      if (!goal) return null
      const status = deriveStatus(goal)

      if (status !== 'active' && status !== 'budget_limited') return null
      return charterText(goal)
    }
  }
}
