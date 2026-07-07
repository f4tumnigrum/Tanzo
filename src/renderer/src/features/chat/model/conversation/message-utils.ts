import type { TanzoDataParts, TanzoUIMessage } from '@shared/agent-message'

export function latestCompaction(
  messages: readonly TanzoUIMessage[]
): TanzoDataParts['compaction'] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j]
      if (part.type === 'data-compaction') return part.data
    }
  }
  return null
}

export function trailingUserMessageId(messages: readonly TanzoUIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.parts.some((part) => part.type === 'data-contextInjection')) continue
    return message.role === 'user' ? message.id : null
  }
  return null
}
