import { describe, expect, it } from 'vitest'
import { createPluginsMentionSection } from '@main/agent/context/sections/plugins-mention'
import type { BuildInput } from '@main/agent/context/section'

const ACTIVE = [
  { name: 'sales', description: 'sell', hasSkills: true, mcpServerNames: ['crm', 'forecast'] },
  { name: 'data-analytics', hasSkills: true, mcpServerNames: [] },
  { name: 'design', hasSkills: false, mcpServerNames: ['figma'] }
]

function render(
  section: ReturnType<typeof createPluginsMentionSection>,
  pluginMention: string[] | null
) {
  return section.render({ chatId: 'c1', pluginMention } as unknown as BuildInput)
}

describe('agent/context/sections/plugins-mention', () => {
  const section = createPluginsMentionSection({
    list: () => ACTIVE,
    peek: () => [],
    take: () => {}
  })

  it('is a volatile leading-user section ordered after the goal hint', () => {
    expect(section.stability).toBe('volatile')
    expect(section.channel).toBe('leading-user')
    expect(section.order).toBe(6)
  })

  it('renders null when there are no mentions', () => {
    expect(render(section, null)).toBeNull()
    expect(render(section, [])).toBeNull()
  })

  it('renders a focus hint naming skill prefix and MCP servers', () => {
    const out = render(section, ['sales']) as string
    expect(out).toContain('<plugin_focus>')
    expect(out).toContain('`sales`')
    expect(out).toContain('skills prefixed `sales:`')
    expect(out).toContain('MCP servers: `crm`, `forecast`')
    expect(out).toContain('</plugin_focus>')
  })

  it('omits the MCP clause for a plugin with no servers and the skill clause for one with no skills', () => {
    const da = render(section, ['data-analytics']) as string
    expect(da).toContain('`data-analytics`')
    expect(da).toContain('skills prefixed `data-analytics:`')
    expect(da).not.toContain('MCP servers:')

    const design = render(section, ['design']) as string
    expect(design).toContain('MCP servers: `figma`')
    expect(design).not.toContain('skills prefixed')
  })

  it('drops mentioned names that are no longer active', () => {
    const out = render(section, ['sales', 'ghost'])
    expect(out).toContain('`sales`')
    expect(out).not.toContain('ghost')
  })

  it('renders null when every mentioned plugin is inactive', () => {
    expect(render(section, ['ghost'])).toBeNull()
  })
})
