import { describe, expect, it, vi } from 'vitest'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  applyApprovalResponse,
  extractPendingApprovals,
  hasUnresolvedApproval,
  lastAssistantText
} from '@main/agent/subagent/approval-utils'

vi.mock('ai', () => ({
  getToolName: vi.fn((part: { type?: string; toolName?: string }) =>
    part.type === 'dynamic-tool'
      ? (part.toolName ?? 'unknown')
      : (part.type?.replace(/^tool-/, '') ?? 'unknown')
  ),
  isDynamicToolUIPart: vi.fn((part: { type?: string }) => part.type === 'dynamic-tool'),
  isToolUIPart: vi.fn((part: { type?: string }) => part.type?.startsWith('tool-') ?? false)
}))

function message(input: Partial<TanzoUIMessage>): TanzoUIMessage {
  return {
    id: 'm',
    role: 'assistant',
    parts: [],
    ...input
  } as TanzoUIMessage
}

describe('agent/subagent-approval', () => {
  it('ignores approvals from before the last user message', () => {
    const messages = [
      message({
        id: 'old',
        parts: [
          {
            type: 'tool-fileRead',
            toolCallId: 'old-call',
            state: 'approval-requested',
            input: { path: 'old' },
            approval: { id: 'old-approval' }
          } as never
        ]
      }),
      message({ id: 'user', role: 'user', parts: [{ type: 'text', text: 'go' }] }),
      message({
        id: 'latest',
        parts: [
          { type: 'text', text: 'checking' },
          {
            type: 'tool-fileEdit',
            toolCallId: 'edit-call',
            state: 'approval-requested',
            input: { path: 'new', oldText: 'a', newText: 'b' },
            approval: { id: 'approval-1' }
          } as never,
          {
            type: 'tool-shell',
            toolCallId: 'shell-call',
            state: 'output-available',
            input: { cmd: 'echo ok' },
            approval: { id: 'done' }
          } as never,
          {
            type: 'dynamic-tool',
            state: 'approval-requested',
            input: { value: 1 },
            approval: { id: 123 }
          } as never
        ]
      })
    ]

    expect(extractPendingApprovals(messages)).toEqual([
      {
        approvalId: 'approval-1',
        toolName: 'fileEdit',
        input: { path: 'new', oldText: 'a', newText: 'b' }
      }
    ])
    expect(extractPendingApprovals([])).toEqual([])
  })

  it('extracts pending approvals across all assistant messages in the current turn', () => {
    const messages = [
      message({ id: 'user', role: 'user', parts: [{ type: 'text', text: 'go' }] }),
      message({
        id: 'a1',
        parts: [
          {
            type: 'tool-fileEdit',
            toolCallId: 'edit-call',
            state: 'approval-requested',
            input: { path: 'first' },
            approval: { id: 'approval-1' }
          } as never
        ]
      }),
      message({
        id: 'a2',
        parts: [
          {
            type: 'tool-shell',
            toolCallId: 'shell-call',
            state: 'approval-requested',
            input: { cmd: 'rm' },
            approval: { id: 'approval-2' }
          } as never
        ]
      })
    ]

    expect(extractPendingApprovals(messages)).toEqual([
      { approvalId: 'approval-1', toolName: 'fileEdit', input: { path: 'first' } },
      { approvalId: 'approval-2', toolName: 'shell', input: { cmd: 'rm' } }
    ])
  })

  it('applies approval responses and returns the matched tool metadata', () => {
    const pending = message({
      id: 'assistant',
      parts: [
        {
          type: 'tool-fileEdit',
          toolCallId: 'edit-call',
          state: 'approval-requested',
          input: { path: 'a.ts', oldText: 'a', newText: 'b' },
          approval: { id: 'approval-1', signature: 'sig-1', isAutomatic: true }
        } as never,
        { type: 'text', text: 'waiting' }
      ]
    })

    const result = applyApprovalResponse(
      [message({ role: 'user' }), pending],
      'approval-1',
      false,
      'Nope'
    )

    expect(result.toolName).toBe('fileEdit')
    expect(result.input).toEqual({ path: 'a.ts', oldText: 'a', newText: 'b' })
    expect(result.messages[1].parts[0]).toMatchObject({
      state: 'approval-responded',
      approval: {
        id: 'approval-1',
        approved: false,
        reason: 'Nope',
        signature: 'sig-1',
        isAutomatic: true
      }
    })
    expect(pending.parts[0]).toMatchObject({ state: 'approval-requested' })

    expect(applyApprovalResponse([pending], 'missing', true)).toEqual({
      messages: [pending],
      input: undefined
    })
  })

  it('preserves signed metadata for dynamic tool approvals', () => {
    const pending = message({
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'mcp_tool',
          toolCallId: 'dynamic-call',
          state: 'approval-requested',
          input: { value: 1 },
          approval: { id: 'dynamic-approval', signature: 'sig-dynamic', isAutomatic: false }
        } as never
      ]
    })

    const result = applyApprovalResponse([pending], 'dynamic-approval', true)

    expect(result.toolName).toBe('mcp_tool')
    expect(result.messages[0].parts[0]).toMatchObject({
      state: 'approval-responded',
      approval: {
        id: 'dynamic-approval',
        approved: true,
        signature: 'sig-dynamic',
        isAutomatic: false
      }
    })
  })

  it('treats requested and responded approvals as unresolved until tool output arrives', () => {
    expect(
      hasUnresolvedApproval([
        message({
          parts: [
            {
              type: 'tool-shell',
              toolCallId: 'call-1',
              state: 'approval-requested',
              approval: { id: 'approval-1' }
            } as never
          ]
        })
      ])
    ).toBe(true)
    expect(
      hasUnresolvedApproval([
        message({
          parts: [
            {
              type: 'tool-shell',
              toolCallId: 'call-1',
              state: 'approval-responded',
              approval: { id: 'approval-1', approved: true }
            } as never
          ]
        })
      ])
    ).toBe(true)
    expect(
      hasUnresolvedApproval([
        message({
          parts: [
            {
              type: 'tool-shell',
              toolCallId: 'call-1',
              state: 'output-available',
              approval: { id: 'approval-1', approved: true }
            } as never
          ]
        })
      ])
    ).toBe(false)
  })

  it('returns trimmed text from the latest assistant message', () => {
    expect(
      lastAssistantText([
        message({ parts: [{ type: 'text', text: 'old' }] }),
        message({ role: 'user', parts: [{ type: 'text', text: 'question' }] }),
        message({
          parts: [
            { type: 'text', text: ' first ' },
            { type: 'tool-fileRead', toolCallId: 'call', state: 'output-available' } as never,
            { type: 'text', text: 'second' }
          ]
        })
      ])
    ).toBe('first \n\nsecond')
    expect(lastAssistantText([])).toBe('')
  })
})
