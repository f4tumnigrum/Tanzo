import { randomUUID } from 'node:crypto'
import type { TanzoUIMessage } from '@shared/agent-message'

type Part = TanzoUIMessage['parts'][number]

export interface Segment {
  messageIndex: number
  partStart: number
  partEnd: number
  isSummary: boolean
}

export interface Cut {
  messageIndex: number
  partIndex: number
}

export interface Partition {
  head: TanzoUIMessage[]
  tail: TanzoUIMessage[]
  archivedIds: string[]
}

export function isSummaryMessage(message: TanzoUIMessage): boolean {
  return message.parts.some((part) => part.type === 'data-compaction')
}

function stepBoundaries(parts: Part[]): number[] {
  const bounds = [0]
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].type === 'step-start') bounds.push(i)
  }
  return bounds
}

export function flattenSegments(messages: TanzoUIMessage[]): Segment[] {
  const segments: Segment[] = []
  messages.forEach((message, messageIndex) => {
    const isSummary = isSummaryMessage(message)
    if (message.role !== 'assistant') {
      segments.push({
        messageIndex,
        partStart: 0,
        partEnd: message.parts.length,
        isSummary
      })
      return
    }
    const bounds = stepBoundaries(message.parts)
    bounds.forEach((partStart, k) => {
      const partEnd = bounds[k + 1] ?? message.parts.length
      segments.push({
        messageIndex,
        partStart,
        partEnd,
        isSummary
      })
    })
  })
  return segments
}

export function findCut(messages: TanzoUIMessage[], retainedRecentSteps: number): Cut {
  const segments = flattenSegments(messages)
  let cutSegment = segments.length
  let keptCount = 0
  const retainCount = Math.max(0, Math.floor(retainedRecentSteps))
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]
    if (segment.isSummary) {
      cutSegment = i + 1
      break
    }
    if (keptCount >= retainCount) {
      cutSegment = i + 1
      break
    }
    keptCount += 1
    cutSegment = i
  }
  if (cutSegment >= segments.length) return { messageIndex: messages.length, partIndex: 0 }
  const segment = segments[cutSegment]
  const cut: Cut = { messageIndex: segment.messageIndex, partIndex: segment.partStart }
  // Guard: if the head portion of a split assistant message contains tool-invocations,
  // their results live in later (tail) messages and would become orphaned. Fall back to
  // a whole-message boundary so the entire message stays in the tail.
  if (cut.partIndex > 0 && headPartsHaveToolInvocation(messages[cut.messageIndex], cut.partIndex)) {
    return { messageIndex: cut.messageIndex, partIndex: 0 }
  }
  return cut
}

function headPartsHaveToolInvocation(message: TanzoUIMessage, partIndex: number): boolean {
  // Tool invocation parts in TanzoUIMessage are named 'tool-{toolName}' or 'dynamic-tool'
  // (consistent with the store.ts filter). Any such part in the head fragment implies
  // a result may live in a subsequent tool-role message that will end up in the tail.
  return message.parts
    .slice(0, partIndex)
    .some((p) => p.type.startsWith('tool-') || p.type === 'dynamic-tool')
}

function normalizeTailParts(parts: Part[]): Part[] {
  const head: Part = parts[0]?.type === 'step-start' ? parts[0] : { type: 'step-start' }
  const rest = parts[0]?.type === 'step-start' ? parts.slice(1) : parts
  let i = 0
  while (i < rest.length && rest[i].type === 'reasoning') i += 1
  return [head, ...rest.slice(i)]
}

export function partitionAtCut(messages: TanzoUIMessage[], cut: Cut): Partition {
  if (cut.partIndex === 0) {
    const head = messages.slice(0, cut.messageIndex)
    return {
      head,
      tail: messages.slice(cut.messageIndex),
      archivedIds: head.map((m) => m.id)
    }
  }
  const splitMessage = messages[cut.messageIndex]
  const headFragment: TanzoUIMessage = {
    ...splitMessage,
    parts: splitMessage.parts.slice(0, cut.partIndex)
  }
  const tailFragment: TanzoUIMessage = {
    id: randomUUID(),
    role: splitMessage.role,
    parts: normalizeTailParts(splitMessage.parts.slice(cut.partIndex))
  }
  const before = messages.slice(0, cut.messageIndex)
  return {
    head: [...before, headFragment],
    tail: [tailFragment, ...messages.slice(cut.messageIndex + 1)],
    archivedIds: [...before.map((m) => m.id), splitMessage.id]
  }
}
