import type { TanzoUIMessage } from '@shared/agent-message'

type Part = TanzoUIMessage['parts'][number]

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

function partsEqual(prev: Part, next: Part): boolean {
  if (prev === next) return true
  if (prev.type !== next.type) return false

  const prevRecord = record(prev)
  const nextRecord = record(next)

  if (typeof prevRecord.text === 'string' || typeof nextRecord.text === 'string') {
    if (prevRecord.text !== nextRecord.text) return false
  }
  if (prevRecord.state !== nextRecord.state) return false

  if (prevRecord.toolCallId !== nextRecord.toolCallId) return false

  try {
    return JSON.stringify(prev) === JSON.stringify(next)
  } catch {
    return false
  }
}

export function stabilizeMessage(
  prev: TanzoUIMessage | undefined,
  next: TanzoUIMessage
): TanzoUIMessage {
  if (!prev || prev === next || prev.id !== next.id) return next

  const prevParts = prev.parts
  const nextParts = next.parts
  let allPartsReused = prevParts.length === nextParts.length

  const stabilizedParts: Part[] = new Array(nextParts.length)
  for (let i = 0; i < nextParts.length; i += 1) {
    const prevPart = prevParts[i]
    if (prevPart !== undefined && partsEqual(prevPart, nextParts[i])) {
      stabilizedParts[i] = prevPart
    } else {
      stabilizedParts[i] = nextParts[i]
      allPartsReused = false
    }
  }

  if (allPartsReused && prev.role === next.role && metadataEqual(prev.metadata, next.metadata)) {
    return prev
  }
  return { ...next, parts: stabilizedParts }
}

function metadataEqual(prev: unknown, next: unknown): boolean {
  if (prev === next) return true
  try {
    return JSON.stringify(prev) === JSON.stringify(next)
  } catch {
    return false
  }
}
