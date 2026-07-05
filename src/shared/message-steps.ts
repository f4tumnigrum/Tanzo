import type { TanzoStepUsageMetadata, TanzoUIMessage } from './agent-message'

/**
 * Step-fragment utilities for message rows.
 *
 * HISTORICAL: migration 22 briefly persisted one row per model step
 * (`a1`, `a1::step-1`, …); that representation was rolled back by migration 23
 * because it gave one reply two identities (live SDK message vs. persisted
 * fragments). Storage is one aggregated row per reply again.
 *
 * These helpers remain solely for the two migrations: `splitAssistantSteps`
 * replays the 22 split; `groupAssistantSteps` is its inverse used by 23 (and
 * safe on databases that never ran 22 — grouping is a no-op without
 * `::step-` fragment runs). Do not use them in runtime code paths.
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

/**
 * Display-side inverse of {@link splitAssistantSteps}: merge consecutive
 * persisted step fragments back into one visual assistant block.
 *
 * The merged block keeps the FIRST fragment's id — which equals the id the AI
 * SDK assigns to the live aggregated message for the same reply. That identity
 * is load-bearing: every id-based path in the renderer (upsertMessage during
 * streaming, mergeRunBaseMessages on conversation switch, the query cache seed,
 * fork/edit targeting) compares the live/persisted views of one reply, and they
 * must agree on the id or the reply renders twice.
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
        // Keep the first fragment's id (== the live SDK message id).
        id: prev.id,
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
