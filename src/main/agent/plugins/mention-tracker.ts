const MENTION_PATTERN = /(?:^|[^\w])@([A-Za-z0-9][A-Za-z0-9_-]*)/g

export interface PluginMentionTracker {
  recordFromText(chatId: string, text: string): void

  peek(chatId: string): string[]

  take(chatId: string): void
}

export function createPluginMentionTracker(knownNames: () => string[]): PluginMentionTracker {
  const pending = new Map<string, string[]>()

  function extractMentions(text: string): string[] {
    const known = new Set(knownNames())
    if (known.size === 0) return []
    const found: string[] = []
    const seen = new Set<string>()
    for (const match of text.matchAll(MENTION_PATTERN)) {
      const name = match[1]
      if (known.has(name) && !seen.has(name)) {
        seen.add(name)
        found.push(name)
      }
    }
    return found
  }

  return {
    recordFromText(chatId, text) {
      const mentions = extractMentions(text)
      if (mentions.length === 0) {
        pending.delete(chatId)
        return
      }
      pending.set(chatId, mentions)
    },
    peek(chatId) {
      return pending.get(chatId) ?? []
    },
    take(chatId) {
      pending.delete(chatId)
    }
  }
}
