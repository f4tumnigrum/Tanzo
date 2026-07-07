import { getToolName, isDynamicToolUIPart, isToolUIPart, type UIMessagePart } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'

type AnyPart = TanzoUIMessage['parts'][number]

interface ApprovalToolPart {
  state?: string
  input?: unknown
  approval?: { id?: string; approved?: boolean; reason?: string }
}

export interface PendingApprovalInfo {
  approvalId: string
  toolName: string
  input: unknown
}

function isToolPart(part: AnyPart): boolean {
  return (
    isToolUIPart(part as UIMessagePart<never, never>) ||
    isDynamicToolUIPart(part as UIMessagePart<never, never>)
  )
}

function lastAssistant(messages: TanzoUIMessage[]): TanzoUIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i]
  }
  return undefined
}

function currentTurnAssistants(messages: TanzoUIMessage[]): TanzoUIMessage[] {
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i
      break
    }
  }
  return messages.slice(lastUserIndex + 1).filter((message) => message.role === 'assistant')
}

export function extractPendingApprovals(messages: TanzoUIMessage[]): PendingApprovalInfo[] {
  const out: PendingApprovalInfo[] = []
  for (const message of currentTurnAssistants(messages)) {
    for (const part of message.parts) {
      if (!isToolPart(part)) continue
      const tp = part as ApprovalToolPart
      if (tp.state !== 'approval-requested') continue
      const id = tp.approval?.id
      if (typeof id !== 'string') continue
      out.push({ approvalId: id, toolName: getToolName(part as never), input: tp.input })
    }
  }
  return out
}

export function hasUnresolvedApproval(messages: TanzoUIMessage[]): boolean {
  const last = lastAssistant(messages)
  if (!last) return false
  return last.parts.some((part) => {
    if (!isToolPart(part)) return false
    const state = (part as ApprovalToolPart).state
    return state === 'approval-requested' || state === 'approval-responded'
  })
}

export function applyApprovalResponse(
  messages: TanzoUIMessage[],
  approvalId: string,
  approved: boolean,
  reason?: string
): { messages: TanzoUIMessage[]; toolName?: string; input?: unknown } {
  let toolName: string | undefined
  let input: unknown
  const next = messages.map((message) => {
    if (message.role !== 'assistant') return message
    let changed = false
    const parts = message.parts.map((part) => {
      if (!isToolPart(part)) return part
      const tp = part as ApprovalToolPart
      if (tp.state !== 'approval-requested' || tp.approval?.id !== approvalId) return part
      changed = true
      toolName = getToolName(part as never)
      input = tp.input
      return {
        ...(part as object),
        state: 'approval-responded',
        approval: { id: approvalId, approved, ...(reason ? { reason } : {}) }
      } as AnyPart
    })
    return changed ? { ...message, parts } : message
  })
  return { messages: next, ...(toolName ? { toolName } : {}), input }
}

export function lastAssistantText(messages: TanzoUIMessage[]): string {
  const last = lastAssistant(messages)
  if (!last) return ''
  return last.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}
