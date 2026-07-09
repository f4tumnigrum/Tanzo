import { getToolName, isDynamicToolUIPart, isToolUIPart, type UIMessagePart } from 'ai'
import type { ChatApprovalResponse } from './chat'
import type { TanzoUIMessage } from './agent-message'

export interface AppliedApprovalResponse {
  toolName: string
  input: unknown
  response: ChatApprovalResponse
}

interface ApprovalToolPart {
  state?: string
  input?: unknown
  approval?: { id?: string; isAutomatic?: boolean; signature?: string }
}

function isToolPart(part: TanzoUIMessage['parts'][number]): boolean {
  return (
    isToolUIPart(part as UIMessagePart<never, never>) ||
    isDynamicToolUIPart(part as UIMessagePart<never, never>)
  )
}

export function hasPendingApprovalRequest(messages: TanzoUIMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.parts.some(
        (part) => isToolPart(part) && (part as ApprovalToolPart).state === 'approval-requested'
      )
  )
}

export function applyApprovalResponses(
  messages: TanzoUIMessage[],
  responses: ChatApprovalResponse[]
): { messages: TanzoUIMessage[]; applied: AppliedApprovalResponse[] } {
  const byApprovalId = new Map(responses.map((response) => [response.approvalId, response]))
  const applied: AppliedApprovalResponse[] = []

  const next = messages.map((message) => {
    if (message.role !== 'assistant') return message
    let changed = false
    const parts = message.parts.map((part) => {
      if (!isToolPart(part)) return part
      const toolPart = part as ApprovalToolPart
      if (toolPart.state !== 'approval-requested') return part
      const approvalId = toolPart.approval?.id
      const response = approvalId ? byApprovalId.get(approvalId) : undefined
      if (!response) return part
      changed = true
      applied.push({
        toolName: getToolName(part as never),
        input: toolPart.input,
        response
      })
      return {
        ...part,
        state: 'approval-responded',
        approval: {
          ...toolPart.approval,
          id: response.approvalId,
          approved: response.approved,
          ...(response.reason ? { reason: response.reason } : {})
        }
      } as TanzoUIMessage['parts'][number]
    })
    return changed ? { ...message, parts } : message
  })

  return { messages: next, applied }
}
