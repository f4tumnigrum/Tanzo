import type { ContextSection } from '../section'
import type { ThreadGoal } from '@shared/goal'
import { pulseText } from '../../goal/templates'

export interface GoalSectionReader {
  get(chatId: string): ThreadGoal | null
}

/**
 * Per-turn goal pulse (v2, invariant I1): the volatile delta — injection kind,
 * remaining budget, stalled warning. A few lines that enter the transcript via
 * the injection channel. The rules live in the goal charter (stable system
 * channel); the pulse never repeats them.
 */
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
