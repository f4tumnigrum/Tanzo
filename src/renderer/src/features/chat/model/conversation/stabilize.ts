import type { TanzoUIMessage } from '@shared/agent-message'

type Part = TanzoUIMessage['parts'][number]

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

/**
 * Conservative structural equality for a single UI message part.
 *
 * `readUIMessageStream` emits a brand-new message object (new parts array,
 * new part objects) for every applied chunk, which defeats `memo` on every
 * already-finished part of the streaming message. This comparison detects
 * unchanged parts so their old object identity can be reused.
 *
 * It is deliberately conservative: cheap discriminators first (type, state,
 * text length), then a JSON comparison as the final arbiter. A false negative
 * merely re-renders one part — exactly today's behavior — while a false
 * positive would freeze the UI on stale data, so unknown shapes fall through
 * to the JSON check rather than assuming equality.
 */
function partsEqual(prev: Part, next: Part): boolean {
  if (prev === next) return true
  if (prev.type !== next.type) return false

  const prevRecord = record(prev)
  const nextRecord = record(next)

  // Fast discriminators shared by text-ish parts.
  if (typeof prevRecord.text === 'string' || typeof nextRecord.text === 'string') {
    if (prevRecord.text !== nextRecord.text) return false
  }
  if (prevRecord.state !== nextRecord.state) return false

  // Tool parts: identity is the toolCallId; state transitions already
  // compared above. Input/output object growth is caught by the JSON check.
  if (prevRecord.toolCallId !== nextRecord.toolCallId) return false

  try {
    return JSON.stringify(prev) === JSON.stringify(next)
  } catch {
    return false
  }
}

/**
 * Reuse unchanged part/message object identities between two snapshots of the
 * same logical message so downstream `memo` boundaries hold during streaming.
 *
 * Returns `prev` itself when nothing changed; otherwise a new message whose
 * unchanged parts keep their previous identity.
 */
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
