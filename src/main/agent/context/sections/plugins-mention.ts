import type { ContextSection } from '../section'

export interface PluginMentionEntry {
  name: string
  description?: string
  hasSkills: boolean
  mcpServerNames: string[]
}

export interface PluginMentionReader {
  /** Capability summaries for currently active plugins, keyed by name. */
  list: () => PluginMentionEntry[]
  /** Plugin names mentioned for this chat's pending turn. */
  peek: (chatId: string) => string[]
  /** Clear the pending mentions for this chat. */
  take: (chatId: string) => void
}

/**
 * Per-turn focus hint for explicitly mentioned plugins. Mirrors Codex's
 * `build_plugin_injections`: when the user `@mentions` a plugin, this volatile
 * leading-user section tells the model to prefer that plugin's capabilities for
 * the turn, naming its skill prefix and available MCP servers.
 *
 * Only mentioned plugins that are still active are rendered (the names are
 * intersected with live capability summaries at build time), so a disabled or
 * uninstalled plugin never produces a stale hint.
 */
export function createPluginsMentionSection(reader: PluginMentionReader): ContextSection {
  return {
    id: 'plugins-mention',
    stability: 'volatile',
    channel: 'leading-user',
    // Just after the goal continuation hint (order 5); both are per-turn
    // leading-user nudges placed close to the user's message.
    order: 6,
    render: ({ pluginMention }) => {
      if (!pluginMention || pluginMention.length === 0) return null
      const active = new Map(reader.list().map((entry) => [entry.name, entry]))
      const mentioned = pluginMention
        .map((name) => active.get(name))
        .filter((entry): entry is PluginMentionEntry => entry !== undefined)
      if (mentioned.length === 0) return null

      const lines = mentioned.map((entry) => {
        const parts = [`- \`${entry.name}\``]
        if (entry.hasSkills) parts.push(`skills prefixed \`${entry.name}:\``)
        if (entry.mcpServerNames.length > 0) {
          parts.push(`MCP servers: ${entry.mcpServerNames.map((n) => `\`${n}\``).join(', ')}`)
        }
        return parts.join('; ')
      })

      return [
        '<plugin_focus>',
        'For this turn the user referenced these plugins. Prefer their capabilities to solve the task:',
        ...lines,
        'Plugins are not invoked directly — use their skills and MCP tools.',
        '</plugin_focus>'
      ].join('\n')
    }
  }
}
