import type { ContextSection } from '../context/section'
import type { PendingHookContext } from './pending-context'

export function createHooksContextSection(pending: PendingHookContext): ContextSection {
  return {
    id: 'hooks',
    stability: 'volatile',
    channel: 'injection',
    order: 25,
    render: ({ chatId }) => {
      const items = pending.drain(chatId)
      if (items.length === 0) return null
      return ['<hook-context>', items.join('\n\n'), '</hook-context>'].join('\n')
    }
  }
}
