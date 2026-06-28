/**
 * Per-turn plugin mention tracker.
 *
 * Mirrors Codex's explicit-mention path (`build_plugin_injections`): when the
 * user `@mentions` a plugin in their message, that plugin is flagged for the
 * immediate turn so the context engine can inject a focused capability hint.
 *
 * The state is intentionally in-memory and one-shot — a mention is recorded at
 * submit and consumed once at the turn's first step (the same lifecycle as a
 * goal injection). Nothing persists across turns or restarts.
 */

/** Bare `@name` tokens, where `name` matches a plugin's skill namespace. */
const MENTION_PATTERN = /(?:^|[^\w])@([A-Za-z0-9][A-Za-z0-9_-]*)/g

export interface PluginMentionTracker {
  /** Scan a user message and record any plugins it explicitly mentions. */
  recordFromText(chatId: string, text: string): void
  /** Plugin names mentioned for this chat's pending turn (read-only). */
  peek(chatId: string): string[]
  /** Clear the pending mentions for this chat. */
  take(chatId: string): void
}

/**
 * @param knownNames Active plugin skill namespaces; only `@mentions` matching
 *   one of these are recorded, so arbitrary `@handles` never inject anything.
 */
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
        // A new message without mentions supersedes any stale pending set so a
        // mention never leaks into a later, unrelated turn.
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
