import type { ContextSection } from '../section'

export interface PluginMentionEntry {
  name: string
  description?: string
  hasSkills: boolean
  mcpServerNames: string[]
}

export interface PluginMentionReader {
  list: () => PluginMentionEntry[]

  peek: (chatId: string) => string[]

  take: (chatId: string) => void
}

export function createPluginsMentionSection(reader: PluginMentionReader): ContextSection {
  return {
    id: 'plugins-mention',
    stability: 'volatile',
    channel: 'injection',

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
