import type { TanzoStepUsageMetadata, TanzoUIMessage } from './agent-message'

type Part = TanzoUIMessage['parts'][number]

const STEP_FRAGMENT_RE = /::step-\d+$/

export function stepFragmentId(baseId: string, index: number): string {
  return `${baseId}::step-${index}`
}

export function stepBaseId(id: string): string {
  return id.replace(STEP_FRAGMENT_RE, '')
}

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

export function splitAssistantSteps(message: TanzoUIMessage): TanzoUIMessage[] {
  if (message.role !== 'assistant') return [message]
  const bounds = stepGroupBounds(message.parts)
  if (bounds.length <= 1) return [message]

  const steps = message.metadata?.steps ?? []
  const groups = bounds.length

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
