import type { ModelMessage } from 'ai'

interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input?: unknown
  providerExecuted?: boolean
}

interface ToolResultPart {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: { type: 'text'; value: string }
}

interface ToolApprovalRequestPart {
  type: 'tool-approval-request'
  approvalId: string
  toolCallId: string
}

interface ToolApprovalResponsePart {
  type: 'tool-approval-response'
  approvalId: string
}

interface ToolOrder {
  callOrder: Map<string, number>
  approvalToCall: Map<string, string>
}

function collectApprovalToCall(messages: ModelMessage[]): Map<string, string> {
  const approvalToCall = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if ((part as { type?: string }).type !== 'tool-approval-request') continue
      const approval = part as ToolApprovalRequestPart
      approvalToCall.set(approval.approvalId, approval.toolCallId)
    }
  }
  return approvalToCall
}

function toolCallIds(message: ModelMessage): Set<string> {
  const ids = new Set<string>()
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return ids
  for (const part of message.content) {
    if ((part as { type?: string }).type === 'tool-call') {
      ids.add((part as ToolCallPart).toolCallId)
    }
  }
  return ids
}

function providerExecutedCallIds(message: ModelMessage): Set<string> {
  const ids = new Set<string>()
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return ids
  for (const part of message.content) {
    if (
      (part as { type?: string }).type === 'tool-call' &&
      (part as ToolCallPart).providerExecuted === true
    ) {
      ids.add((part as ToolCallPart).toolCallId)
    }
  }
  return ids
}

function toolBlockEnd(messages: ModelMessage[], start: number): number {
  let end = start
  while (
    end < messages.length &&
    messages[end].role === 'tool' &&
    Array.isArray(messages[end].content)
  ) {
    end += 1
  }
  return end
}

function collectToolBlockResolution(
  messages: ModelMessage[],
  start: number,
  end: number,
  approvalToCall: Map<string, string>
): { resultCallIds: Set<string>; respondedCallIds: Set<string> } {
  const resultCallIds = new Set<string>()
  const respondedCallIds = new Set<string>()
  for (let i = start; i < end; i += 1) {
    const message = messages[i]
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      const type = (part as { type?: string }).type
      if (type === 'tool-result') {
        resultCallIds.add((part as ToolResultPart).toolCallId)
      }
      if (type === 'tool-approval-response') {
        const callId = approvalToCall.get((part as ToolApprovalResponsePart).approvalId)
        if (callId) respondedCallIds.add(callId)
      }
    }
  }
  return { resultCallIds, respondedCallIds }
}

function filterAssistantContent(
  message: ModelMessage,
  validCallIds: Set<string>
): ModelMessage | null {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return message
  const kept = message.content.filter((part) => {
    const type = (part as { type?: string }).type
    if (type === 'tool-call') return validCallIds.has((part as ToolCallPart).toolCallId)
    if (type === 'tool-approval-request') {
      return validCallIds.has((part as ToolApprovalRequestPart).toolCallId)
    }
    return true
  })
  return kept.length > 0 ? ({ ...message, content: kept } as ModelMessage) : null
}

function filterToolContent(
  message: ModelMessage,
  validCallIds: Set<string>,
  approvalToCall: Map<string, string>
): ModelMessage | null {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return message
  const kept = message.content.filter((part) => {
    const type = (part as { type?: string }).type
    if (type === 'tool-result') return validCallIds.has((part as ToolResultPart).toolCallId)
    if (type === 'tool-approval-response') {
      const callId = approvalToCall.get((part as ToolApprovalResponsePart).approvalId)
      return callId !== undefined && validCallIds.has(callId)
    }
    return true
  })
  return kept.length > 0 ? ({ ...message, content: kept } as ModelMessage) : null
}

function resolvedCallIdsForBlock(
  calls: Set<string>,
  providerExecutedCalls: Set<string>,
  resultCallIds: Set<string>,
  respondedCallIds: Set<string>,
  isFinalToolBlock: boolean
): Set<string> {
  const valid = new Set(providerExecutedCalls)
  for (const callId of calls) {
    if (resultCallIds.has(callId) || (isFinalToolBlock && respondedCallIds.has(callId))) {
      valid.add(callId)
    }
  }
  return valid
}

function ensureToolPairing(messages: ModelMessage[]): ModelMessage[] {
  const approvalToCall = collectApprovalToCall(messages)
  const out: ModelMessage[] = []

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    const calls = toolCallIds(message)

    if (message.role === 'assistant' && calls.size > 0) {
      const blockStart = i + 1
      const blockEnd = toolBlockEnd(messages, blockStart)
      const { resultCallIds, respondedCallIds } = collectToolBlockResolution(
        messages,
        blockStart,
        blockEnd,
        approvalToCall
      )
      const validCallIds = resolvedCallIdsForBlock(
        calls,
        providerExecutedCallIds(message),
        resultCallIds,
        respondedCallIds,
        blockEnd === messages.length
      )
      const assistant = filterAssistantContent(message, validCallIds)
      if (assistant) out.push(assistant)
      for (let j = blockStart; j < blockEnd; j += 1) {
        const tool = filterToolContent(messages[j], validCallIds, approvalToCall)
        if (tool) out.push(tool)
      }
      i = blockEnd - 1
      continue
    }

    if (message.role === 'tool') {
      const tool = filterToolContent(message, new Set(), approvalToCall)
      if (tool) out.push(tool)
      continue
    }

    out.push(message)
  }

  return out
}

function collectToolOrder(messages: ModelMessage[]): ToolOrder {
  const callOrder = new Map<string, number>()
  const approvalToCall = collectApprovalToCall(messages)
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      const type = (part as { type?: string }).type
      if (type === 'tool-call') {
        const call = part as ToolCallPart
        if (!callOrder.has(call.toolCallId)) callOrder.set(call.toolCallId, callOrder.size)
      }
    }
  }
  return { callOrder, approvalToCall }
}

function toolPartOrder(
  part: unknown,
  order: ToolOrder,
  fallback: number
): [number, number, number] {
  const type = (part as { type?: string }).type
  if (type === 'tool-result') {
    const result = part as ToolResultPart
    return [order.callOrder.get(result.toolCallId) ?? Number.MAX_SAFE_INTEGER, 0, fallback]
  }
  if (type === 'tool-approval-response') {
    const approval = part as ToolApprovalResponsePart
    const callId = order.approvalToCall.get(approval.approvalId)
    return [
      callId ? (order.callOrder.get(callId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER,
      1,
      fallback
    ]
  }
  return [Number.MAX_SAFE_INTEGER, 2, fallback]
}

function canonicalizeToolContent(messages: ModelMessage[]): ModelMessage[] {
  const order = collectToolOrder(messages)
  const out: ModelMessage[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      out.push(message)
      continue
    }

    const end = toolBlockEnd(messages, i)
    const parts: unknown[] = []
    for (let j = i; j < end; j += 1) {
      const tool = messages[j]
      if (tool.role === 'tool' && Array.isArray(tool.content)) parts.push(...tool.content)
    }
    const content = parts
      .map((part, index) => ({ part, order: toolPartOrder(part, order, index) }))
      .sort((a, b) => {
        for (let j = 0; j < a.order.length; j += 1) {
          const diff = a.order[j] - b.order[j]
          if (diff !== 0) return diff
        }
        return 0
      })
      .map(({ part }) => part)
    out.push({ ...message, content } as ModelMessage)
    i = end - 1
  }
  return out
}

export function canonicalizeToolTranscript(messages: ModelMessage[]): ModelMessage[] {
  return canonicalizeToolContent(ensureToolPairing(messages))
}
