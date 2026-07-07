import type { ModelMessage, SystemModelMessage } from 'ai'
import type {
  BuildInput,
  CompiledContext,
  ContextMessageProvenance,
  ContextSection,
  ContextSectionProvenance,
  Stability
} from './section'

export interface RenderedSection {
  section: ContextSection
  text: string
}

function byStability(rendered: RenderedSection[], stability: Stability): RenderedSection[] {
  return rendered
    .filter((r) => r.section.stability === stability)
    .sort((a, b) => a.section.order - b.section.order)
}

function sectionProvenance(rendered: RenderedSection): ContextSectionProvenance {
  return {
    sectionId: rendered.section.id,
    stability: rendered.section.stability,
    channel: rendered.section.channel
  }
}

function messageProvenance(rendered: RenderedSection[]): ContextMessageProvenance[] {
  return rendered.length ? [{ sections: rendered.map(sectionProvenance) }] : []
}

export async function renderSections(
  registry: ContextSection[],
  input: BuildInput
): Promise<RenderedSection[]> {
  const results = await Promise.all(
    registry
      .filter((section) => section.channel !== 'injection')
      .map(async (section) => {
        const text = await section.render(input)
        return text == null || text.length === 0 ? null : { section, text }
      })
  )
  return results.filter((r): r is RenderedSection => r !== null)
}

export function assembleContext(
  rendered: RenderedSection[],
  history: ModelMessage[]
): CompiledContext {
  const stable = byStability(rendered, 'stable')
  const volatile = byStability(rendered, 'volatile')

  const stableSystem = stable.filter((r) => r.section.channel === 'system')
  const volatileSystem = volatile.filter((r) => r.section.channel === 'system')
  const system: SystemModelMessage[] = [...stableSystem, ...volatileSystem].map((r) => ({
    role: 'system',
    content: r.text
  }))

  const leading = [
    ...stable.filter((r) => r.section.channel === 'leading-user'),
    ...volatile.filter((r) => r.section.channel === 'leading-user')
  ]
  const leadingUser: ModelMessage[] = leading.length
    ? [{ role: 'user', content: leading.map((r) => r.text).join('\n\n') }]
    : []

  return {
    system,
    stableBoundary: stableSystem.length,
    leadingUser,
    history,
    provenance: {
      system: [...stableSystem, ...volatileSystem].map(sectionProvenance),
      leadingUser: messageProvenance(leading),
      history: history.map(() => undefined)
    }
  }
}

export async function compileSections(
  registry: ContextSection[],
  input: BuildInput,
  history: ModelMessage[]
): Promise<CompiledContext> {
  return assembleContext(await renderSections(registry, input), history)
}
