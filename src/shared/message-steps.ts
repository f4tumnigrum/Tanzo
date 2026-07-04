import type { TanzoStepUsageMetadata, TanzoUIMessage } from './agent-message'

/**
 * Per-step message rows (design §4.5).
 *
 * The AI SDK aggregates a whole model pass into one assistant UIMessage whose
 * parts are delimited by `step-start` markers. Persistence splits that message
 * into one row per step group so that:
 * - compaction cuts always land on whole rows (no mid-message splits),
 * - the overlay `covers_from_seq/covers_to_seq` semantics are exact,
 * - the token-ledger anchor is one reported step per message.
 *
 * The renderer's live stream still reconstructs the single SDK message; the
 * display layer regroups persisted fragments (`groupAssistantSteps` in the
 * renderer) so the visual stays one block per reply.
 */

type Part = TanzoUIMessage['parts'][number]

const STEP_FRAGMENT_RE = /::step-\d+$/

export function stepFragmentId(baseId: string, index: number): string {
  return `${baseId}::step-${index}`
}

/** Strip one trailing fragment suffix: `abc::step-2` → `abc`. */
export function stepBaseId(id: string): string {
  return id.replace(STEP_FRAGMENT_RE, '')
}

/** True when `id` is a step fragment continuing the message `previousId`. */
export function isStepFragmentOf(previousId: string, id: string): boolean {
  return id.startsWith(`${stepBaseId(previousId)}::step-`)
}

function stepGroupBounds(parts: Part[]): number[] {
  const bounds: number[] = [0]
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].type === 'step-start') bounds.push(i)
  }
  return bounds
}

/**
 * Split a multi-step assistant message into one message per step group.
 * Single-step messages (the common case) pass through untouched, so ids and
 * content stay byte-identical for simple replies.
 *
 * Fragment ids are deterministic (`{baseId}::step-k`) because the split runs
 * after every step and the persistence merge is id-based — the same input
 * must always produce the same fragment ids.
 */
export function splitAssistantSteps(message: TanzoUIMessage): TanzoUIMessage[] {
  if (message.role !== 'assistant') return [message]
  const bounds = stepGroupBounds(message.parts)
  if (bounds.length <= 1) return [message]

  const steps = message.metadata?.steps ?? []
  const groups = bounds.length
  // Steps align with the *newest* groups: a continuation run (post-approval)
  // replaces the metadata with its own steps while the parts still carry the
  // previous run's leading group(s).
  const stepAt = (k: number): TanzoStepUsageMetadata | undefined => steps[steps.length - groups + k]

  return bounds.map((start, k) => {
    const end = bounds[k + 1] ?? message.parts.length
    const step = stepAt(k)
    const isLast = k === groups - 1
    const createdAt = message.metadata?.createdAt
    const usage = isLast ? message.metadata?.usage : undefined
    const metadata: TanzoUIMessage['metadata'] = {
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(step ? { steps: [step] } : {}),
      ...(usage ? { usage } : {})
    }
    const fragment: TanzoUIMessage = {
      id: k === 0 ? message.id : stepFragmentId(message.id, k),
      role: 'assistant',
      parts: message.parts.slice(start, end)
    }
    if (Object.keys(metadata).length > 0) fragment.metadata = metadata
    return fragment
  })
}

/** Split every assistant message in a transcript into per-step rows. */
export function splitStepMessages(messages: TanzoUIMessage[]): TanzoUIMessage[] {
  return messages.flatMap((message) => splitAssistantSteps(message))
}

/**
 * Display-side inverse of {@link splitAssistantSteps}: merge consecutive
 * persisted step fragments back into one visual assistant block.
 *
 * The merged message takes the LAST fragment's id so that fork (which slices
 * the transcript through the target id) captures the whole reply, and so the
 * streaming indicator (keyed to the last transcript message) still matches.
 */
export function groupAssistantSteps(messages: readonly TanzoUIMessage[]): TanzoUIMessage[] {
  const result: TanzoUIMessage[] = []
  for (const message of messages) {
    const prev = result.at(-1)
    if (
      prev &&
      prev.role === 'assistant' &&
      message.role === 'assistant' &&
      isStepFragmentOf(prev.id, message.id)
    ) {
      const steps = [...(prev.metadata?.steps ?? []), ...(message.metadata?.steps ?? [])]
      const metadata: TanzoUIMessage['metadata'] = {
        ...prev.metadata,
        ...message.metadata,
        ...(steps.length > 0 ? { steps } : {})
      }
      const merged: TanzoUIMessage = {
        ...message,
        parts: [...prev.parts, ...message.parts]
      }
      if (Object.keys(metadata).length > 0) merged.metadata = metadata
      else delete merged.metadata
      result[result.length - 1] = merged
      continue
    }
    result.push(message)
  }
  return result
}
