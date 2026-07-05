import { describe, expect, it } from 'vitest'
import type { ThreadGoal } from '@shared/goal'
import { charterText, pulseText } from '@main/agent/goal/templates'
import { BLOCK_ATTEMPTS_REQUIRED } from '@main/agent/goal/goal.machine'

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    chatId: 'c1',
    objective: 'Write 5 joke files',
    userState: 'active',
    outcome: null,
    limit: null,
    tokenBudget: null,
    tokensUsed: 0,
    timeBudgetSeconds: null,
    timeUsedSeconds: 0,
    idleStreak: 0,
    blockerStreak: 0,
    blockerLastRunId: null,
    pendingInjection: 'continuation',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('agent/goal/templates', () => {
  describe('charterText', () => {
    it('carries the objective and the full decision procedure', () => {
      const text = charterText(goal())
      expect(text).toContain('<goal_charter>')
      expect(text).toContain('<objective>\nWrite 5 joke files\n</objective>')
      expect(text).toContain('Work —')
      expect(text).toContain('Finish —')
      expect(text).toContain('Block —')
      expect(text).toContain(`${BLOCK_ATTEMPTS_REQUIRED} recorded attempts`)
    })

    it('is byte-identical across renders while the goal is unchanged (cache prefix)', () => {
      const a = charterText(goal({ tokensUsed: 100 }))
      const b = charterText(goal({ tokensUsed: 900, idleStreak: 2, updatedAt: 99 }))
      // Budget numbers and streaks must NOT leak into the charter.
      expect(a).toBe(b)
    })

    it('references the registered updateGoal tool, never a snake_case name', () => {
      expect(charterText(goal())).not.toContain('update_goal')
      expect(charterText(goal())).toContain('updateGoal(status="complete")')
    })
  })

  describe('pulseText', () => {
    it('continuation pulse is small and never repeats the rules', () => {
      const text = pulseText(goal({ tokenBudget: 1000, tokensUsed: 250 }), 'continuation')
      expect(text).toContain('<goal_pulse>')
      expect(text).toContain('750 of 1000 budget tokens remaining')
      expect(text).not.toContain('Work —') // rules live in the charter
      expect(text.length).toBeLessThan(600)
    })

    it('omits the budget line when no budget is set', () => {
      const text = pulseText(goal(), 'continuation')
      expect(text).not.toContain('Budget:')
    })

    it('escalates with a stalled warning once a turn made no progress', () => {
      const steady = pulseText(goal({ idleStreak: 0 }), 'continuation')
      const stalled = pulseText(goal({ idleStreak: 1 }), 'continuation')
      expect(steady).not.toContain('Warning')
      expect(stalled).toContain('no detectable progress')
      expect(stalled).toContain('not a valid turn')
    })

    it('budget_limit pulse tells the model to wrap up', () => {
      const text = pulseText(goal({ tokenBudget: 100, tokensUsed: 120 }), 'budget_limit')
      expect(text).toContain('budget_limited')
      expect(text).toContain("Don't start new substantive work")
      expect(text).toContain('0 of 100 budget tokens remaining')
    })

    it('objective_updated pulse defers to the charter for the new objective', () => {
      const text = pulseText(goal({ objective: 'New objective' }), 'objective_updated')
      expect(text).toContain('replaces any earlier objective')
      expect(text).toContain('goal charter')
      // The objective itself lives in the charter, not the pulse.
      expect(text).not.toContain('<objective>')
    })

    it('never references a snake_case tool name', () => {
      for (const injection of ['continuation', 'budget_limit', 'objective_updated'] as const) {
        expect(pulseText(goal(), injection)).not.toContain('update_goal')
      }
    })
  })
})
