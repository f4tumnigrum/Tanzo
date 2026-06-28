import { describe, expect, it } from 'vitest'
import { createPluginsIndexSection } from '@main/agent/context/sections/plugins-index'
import type { BuildInput } from '@main/agent/context/section'

const input = {} as BuildInput

describe('agent/context/sections/plugins-index', () => {
  it('renders nothing when no plugins are enabled', async () => {
    const section = createPluginsIndexSection({ list: () => [] })
    expect(await section.render(input)).toBeNull()
  })

  it('renders enabled plugins as a name + description catalog', async () => {
    const section = createPluginsIndexSection({
      list: () => [
        { name: 'sales', description: 'Sales workflows' },
        { name: 'bare' }
      ]
    })
    const text = (await section.render(input)) as string
    expect(text).toContain('<plugins>')
    expect(text).toContain('</plugins>')
    expect(text).toContain('- sales: Sales workflows')
    expect(text).toContain('- bare')
    // A bare plugin has no trailing ": " separator.
    expect(text).not.toContain('- bare:')
    // No skill bodies or tool schemas — only the catalog + usage guidance.
    expect(text).toContain('prefixed with `name:`')
  })

  it('is a stable system section ordered right after the skills catalog', () => {
    const section = createPluginsIndexSection({ list: () => [] })
    expect(section.id).toBe('plugins-index')
    expect(section.stability).toBe('stable')
    expect(section.channel).toBe('system')
    expect(section.order).toBe(31)
  })
})
