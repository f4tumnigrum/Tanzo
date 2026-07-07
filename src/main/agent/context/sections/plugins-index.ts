import type { ContextSection } from '../section'

export interface PluginIndexEntry {
  name: string
  description?: string
}

export interface PluginsIndexReader {
  list: () => PluginIndexEntry[]
}

export function createPluginsIndexSection(reader: PluginsIndexReader): ContextSection {
  return {
    id: 'plugins-index',
    stability: 'stable',
    channel: 'system',

    order: 31,
    render: () => {
      const plugins = reader.list()
      if (plugins.length === 0) return null
      const lines = plugins.map((p) =>
        p.description ? `- ${p.name}: ${p.description}` : `- ${p.name}`
      )
      return [
        '<plugins>',
        'Plugins are local bundles of skills and MCP servers enabled in this session. When a plugin is relevant to the task, prefer its capabilities over standalone ones that do the same thing.',
        ...lines,
        "A plugin's skills appear in the skills list prefixed with `name:`. Plugins are not invoked directly — use their skills and MCP tools to do the work.",
        '</plugins>'
      ].join('\n')
    }
  }
}
