import { randomUUID } from 'node:crypto'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { BuildInput, ContextSection } from './section'

export async function renderContextInjection(
  registry: ContextSection[],
  input: BuildInput
): Promise<TanzoUIMessage | null> {
  const sections = registry
    .filter((section) => section.channel === 'injection')
    .sort((a, b) => a.order - b.order)
  if (sections.length === 0) return null

  const rendered = await Promise.all(
    sections.map(async (section) => {
      const text = await section.render(input)
      return text == null || text.length === 0 ? null : { id: section.id, text }
    })
  )
  const kept = rendered.filter((r): r is { id: string; text: string } => r !== null)
  if (kept.length === 0) return null

  const text = kept.map((r) => r.text).join('\n\n')
  return {
    id: randomUUID(),
    role: 'user',
    parts: [
      { type: 'text', text },
      {
        type: 'data-contextInjection',
        data: { sections: kept.map((r) => r.id) }
      }
    ]
  }
}

export function isContextInjectionMessage(message: TanzoUIMessage): boolean {
  return message.parts.some((part) => part.type === 'data-contextInjection')
}

export function renderedSectionIds(message: TanzoUIMessage): Set<string> {
  for (const part of message.parts) {
    if (part.type === 'data-contextInjection') {
      const sections = (part.data as { sections?: string[] } | undefined)?.sections
      return new Set(sections ?? [])
    }
  }
  return new Set()
}
