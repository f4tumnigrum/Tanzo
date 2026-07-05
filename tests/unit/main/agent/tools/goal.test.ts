import { describe, expect, it, vi } from 'vitest'
import type { ToolDeps } from '@main/agent/tools/types'
import { updateGoalTool } from '@main/agent/tools/goal'
import { BLOCK_ATTEMPTS_REQUIRED } from '@main/agent/goal/goal.machine'

function deps(overrides: Partial<ToolDeps['goal']> = {}): ToolDeps {
  return {
    goal: {
      get: vi.fn(() => null),
      markOutcome: vi.fn(() => ({ kind: 'applied' })),
      ...overrides
    }
  } as unknown as ToolDeps
}

describe('main/agent/tools/goal', () => {
  it('marks the goal complete via markOutcome', async () => {
    const d = deps()

    const output = await (
      updateGoalTool(d, 'chat-1', 'run-1') as unknown as { execute: (input: unknown) => unknown }
    ).execute({ status: 'complete' })

    expect(output).toEqual({ updated: true, status: 'complete' })
    expect(d.goal.markOutcome).toHaveBeenCalledWith('chat-1', 'complete', { runId: 'run-1' })
  })

  it('returns an error when no goal exists', async () => {
    const d = deps({ markOutcome: vi.fn(() => ({ kind: 'no-goal' }) as const) })

    const output = await (
      updateGoalTool(d, 'chat-1') as unknown as { execute: (input: unknown) => unknown }
    ).execute({ status: 'blocked' })

    expect(output).toMatchObject({ error: true })
  })

  it('reports a recorded block attempt when the machine rejects early blocking', async () => {
    const d = deps({
      markOutcome: vi.fn(
        () => ({ kind: 'rejected', attempts: 1, required: BLOCK_ATTEMPTS_REQUIRED }) as const
      )
    })

    const output = await (
      updateGoalTool(d, 'chat-1', 'run-1') as unknown as { execute: (input: unknown) => unknown }
    ).execute({ status: 'blocked' })

    expect(output).toMatchObject({
      recorded: true,
      attempts: 1,
      required: BLOCK_ATTEMPTS_REQUIRED
    })
    expect((output as { message: string }).message).toContain('1/' + BLOCK_ATTEMPTS_REQUIRED)
  })
})
