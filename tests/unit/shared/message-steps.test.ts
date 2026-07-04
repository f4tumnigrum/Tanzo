import { describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  groupAssistantSteps,
  isStepFragmentOf,
  splitAssistantSteps,
  splitStepMessages,
  stepBaseId,
  stepFragmentId
} from '@shared/message-steps'

function user(id: string, text: string): TanzoUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as TanzoUIMessage
}

const MULTI_STEP: TanzoUIMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [
    { type: 'step-start' },
    { type: 'text', text: 'step one' },
    { type: 'step-start' },
    { type: 'reasoning', text: 'thinking' },
    { type: 'text', text: 'step two' },
    { type: 'step-start' },
    { type: 'text', text: 'step three' }
  ],
  metadata: {
    createdAt: 1000,
    usage: { inputTokens: 300, outputTokens: 30, totalTokens: 330 },
    steps: [
      { stepNumber: 1, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
      { stepNumber: 2, usage: { inputTokens: 200, outputTokens: 10, totalTokens: 210 } },
      { stepNumber: 3, usage: { inputTokens: 300, outputTokens: 10, totalTokens: 310 } }
    ]
  }
} as TanzoUIMessage

describe('shared/message-steps', () => {
  it('ids: fragment ids are deterministic and reversible', () => {
    expect(stepFragmentId('a1', 2)).toBe('a1::step-2')
    expect(stepBaseId('a1::step-2')).toBe('a1')
    expect(stepBaseId('a1')).toBe('a1')
    expect(isStepFragmentOf('a1', 'a1::step-1')).toBe(true)
    expect(isStepFragmentOf('a1::step-1', 'a1::step-2')).toBe(true)
    expect(isStepFragmentOf('a1', 'a2::step-1')).toBe(false)
  })

  it('passes single-step and non-assistant messages through untouched', () => {
    const plain = user('u1', 'hi')
    expect(splitAssistantSteps(plain)).toEqual([plain])
    const single: TanzoUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'step-start' }, { type: 'text', text: 'only' }]
    } as TanzoUIMessage
    expect(splitAssistantSteps(single)).toEqual([single])
  })

  it('splits a multi-step message into one row per step group with aligned metadata', () => {
    const rows = splitAssistantSteps(MULTI_STEP)
    expect(rows.map((row) => row.id)).toEqual(['a1', 'a1::step-1', 'a1::step-2'])
    expect(rows[0].parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'step one' }])
    expect(rows[1].parts).toEqual([
      { type: 'step-start' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'step two' }
    ])
    // Each row carries exactly its own step usage (the ledger anchor shape).
    expect(rows[0].metadata?.steps).toEqual([MULTI_STEP.metadata!.steps![0]])
    expect(rows[1].metadata?.steps).toEqual([MULTI_STEP.metadata!.steps![1]])
    expect(rows[2].metadata?.steps).toEqual([MULTI_STEP.metadata!.steps![2]])
    // The aggregate usage rides only on the last fragment.
    expect(rows[0].metadata?.usage).toBeUndefined()
    expect(rows[2].metadata?.usage).toEqual(MULTI_STEP.metadata!.usage)
    expect(rows.every((row) => row.metadata?.createdAt === 1000)).toBe(true)
  })

  it('aligns steps to the newest groups on continuation (parts > steps)', () => {
    // Post-approval continuation: metadata carries only the new run's steps
    // while the parts still include the previous run's leading group.
    const continued: TanzoUIMessage = {
      ...MULTI_STEP,
      metadata: {
        steps: [
          { stepNumber: 1, usage: { inputTokens: 500, outputTokens: 5, totalTokens: 505 } },
          { stepNumber: 2, usage: { inputTokens: 600, outputTokens: 5, totalTokens: 605 } }
        ]
      }
    } as TanzoUIMessage
    const rows = splitAssistantSteps(continued)
    expect(rows).toHaveLength(3)
    expect(rows[0].metadata?.steps).toBeUndefined()
    expect(rows[1].metadata?.steps?.[0]?.usage?.inputTokens).toBe(500)
    expect(rows[2].metadata?.steps?.[0]?.usage?.inputTokens).toBe(600)
  })

  it('groupAssistantSteps is the display inverse of splitStepMessages', () => {
    const transcript = [user('u1', 'go'), MULTI_STEP, user('u2', 'next')]
    const rows = splitStepMessages(transcript)
    expect(rows).toHaveLength(5)

    const grouped = groupAssistantSteps(rows)
    expect(grouped).toHaveLength(3)
    const merged = grouped[1]
    expect(merged.parts).toEqual(MULTI_STEP.parts)
    expect(merged.metadata?.steps).toEqual(MULTI_STEP.metadata!.steps)
    expect(merged.metadata?.usage).toEqual(MULTI_STEP.metadata!.usage)
    // The merged block takes the LAST fragment id (fork slices through it).
    expect(merged.id).toBe('a1::step-2')
  })

  it('does not merge unrelated consecutive assistant messages', () => {
    const a: TanzoUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'one' }]
    } as TanzoUIMessage
    const b: TanzoUIMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'two' }]
    } as TanzoUIMessage
    expect(groupAssistantSteps([a, b])).toEqual([a, b])
  })
})
