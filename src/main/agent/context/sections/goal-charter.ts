import type { ContextSection } from '../section'
import type { ThreadGoal } from '@shared/goal'
import { deriveStatus } from '@shared/goal'
import { charterText } from '../../goal/templates'

export interface GoalCharterReader {
  get(chatId: string): ThreadGoal | null
}

/**
 * Standing goal declaration (v2, invariant I1). Lives in the stable system
 * channel: byte-identical across turns while the goal is unchanged, so it sits
 * inside the provider cache prefix and the model sees the goal on every turn —
 * not just continuation turns. Renders null when no goal demands attention;
 * the charter disappearing is itself the signal that the goal ended.
 *
 * Stability contract: goal lifecycle changes (create/edit/clear/pause) happen
 * at turn boundaries only — the run-level section snapshot (invariant I7)
 * freezes the rendered text for the duration of a run.
 */
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
      // budget_limited keeps the charter: the wrap-up turn still needs the
      // objective. paused/complete/blocked/usage_limited drop it.
      if (status !== 'active' && status !== 'budget_limited') return null
      return charterText(goal)
    }
  }
}
