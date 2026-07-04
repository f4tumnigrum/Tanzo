import { randomUUID } from 'node:crypto'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { BuildInput, ContextSection } from './section'

/**
 * Render the `injection` channel sections into a persisted synthetic user
 * message (v2). Volatile per-turn content (datetime, git snapshot, goal
 * nudges, plugin focus, hook context) enters the transcript exactly once, at
 * turn start — so the prompt prefix stays append-only within a run and the
 * persisted history always matches what the model actually saw.
 *
 * The message carries a `data-context-injection` part so the renderer can
 * collapse it; the text part is what reaches the model.
 */
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
