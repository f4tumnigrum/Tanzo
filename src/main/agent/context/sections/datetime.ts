import type { ContextSection } from '../section'

export interface ClockDeps {
  now: () => Date
}

export function createDatetimeSection(deps: ClockDeps): ContextSection {
  return {
    id: 'datetime',
    stability: 'volatile',
    channel: 'injection',
    order: 0,
    render: () => {
      const now = deps.now()
      const date = now.toLocaleDateString('en-CA')
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      return [
        '<datetime>',
        `date: ${date} (${weekday})`,
        `timezone: ${timezone}`,
        '</datetime>'
      ].join('\n')
    }
  }
}
