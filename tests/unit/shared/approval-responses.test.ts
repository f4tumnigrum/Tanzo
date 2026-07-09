import { describe, expect, it } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import { applyApprovalResponses } from '@shared/approval-responses'

const history: TanzoUIMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'edit the file' }] },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'I will edit it.' },
      {
        type: 'tool-fileEdit',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { path: 'src/main.ts', oldText: 'a', newText: 'b' },
        approval: { id: 'approval-1', signature: 'sig-1', isAutomatic: false }
      },
      {
        type: 'tool-shell',
        toolCallId: 'call-2',
        state: 'approval-requested',
        input: { command: 'rm dist -r' },
        approval: { id: 'approval-2' }
      }
    ]
  }
] as TanzoUIMessage[]

describe('agent/runtime/approval-responses', () => {
  it('patches matching approval-requested tool parts and reports applied responses', () => {
    const { messages, applied } = applyApprovalResponses(history, [
      { approvalId: 'approval-1', approved: true, scope: 'forever' },
      { approvalId: 'approval-2', approved: false, reason: 'too risky' }
    ])

    expect(messages[0]).toBe(history[0])
    const parts = messages[1].parts as Array<Record<string, unknown>>
    expect(parts[1]).toMatchObject({
      state: 'approval-responded',
      approval: {
        id: 'approval-1',
        approved: true,
        signature: 'sig-1',
        isAutomatic: false
      }
    })
    expect(parts[2]).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'approval-2', approved: false, reason: 'too risky' }
    })

    expect(applied).toEqual([
      {
        toolName: 'fileEdit',
        input: { path: 'src/main.ts', oldText: 'a', newText: 'b' },
        response: { approvalId: 'approval-1', approved: true, scope: 'forever' }
      },
      {
        toolName: 'shell',
        input: { command: 'rm dist -r' },
        response: { approvalId: 'approval-2', approved: false, reason: 'too risky' }
      }
    ])
  })

  it('leaves messages untouched when no approval id matches', () => {
    const { messages, applied } = applyApprovalResponses(history, [
      { approvalId: 'missing', approved: true }
    ])

    expect(messages[1]).toBe(history[1])
    expect(applied).toEqual([])
  })

  it('ignores tool parts that already left the approval-requested state', () => {
    const responded: TanzoUIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: { path: 'src/main.ts' },
            approval: { id: 'approval-1', approved: true }
          }
        ]
      }
    ] as TanzoUIMessage[]

    const { messages, applied } = applyApprovalResponses(responded, [
      { approvalId: 'approval-1', approved: false }
    ])

    expect(messages[0]).toBe(responded[0])
    expect(applied).toEqual([])
  })
})
