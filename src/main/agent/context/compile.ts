import type { ModelMessage, SystemModelMessage } from 'ai'
import type {
  BuildInput,
  CompiledContext,
  ContextMessageProvenance,
  ContextSection,
  ContextSectionProvenance,
  Stability
} from './section'

interface Rendered {
  section: ContextSection
  text: string
}

async function renderAll(registry: ContextSection[], input: BuildInput): Promise<Rendered[]> {
  const results = await Promise.all(
    registry.map(async (section) => {
      const text = await section.render(input)
      return text == null || text.length === 0 ? null : { section, text }
    })
  )
  return results.filter((r): r is Rendered => r !== null)
}

function byStability(rendered: Rendered[], stability: Stability): Rendered[] {
  return rendered
    .filter((r) => r.section.stability === stability)
    .sort((a, b) => a.section.order - b.section.order)
}

function sectionProvenance(rendered: Rendered): ContextSectionProvenance {
  return {
    sectionId: rendered.section.id,
    stability: rendered.section.stability,
    channel: rendered.section.channel
  }
}

function messageProvenance(rendered: Rendered[]): ContextMessageProvenance[] {
  return rendered.length ? [{ sections: rendered.map(sectionProvenance) }] : []
}

/**
 * Compile the `system` and `leading-user` channels (v2). `injection` channel
 * sections are rendered separately (see injection.ts) and persisted into the
 * transcript, so this output is stable for the duration of a run — the
 * append-only prefix invariant.
 */
export async function compileSections(
  registry: ContextSection[],
  input: BuildInput,
  history: ModelMessage[]
): Promise<CompiledContext> {
  const rendered = await renderAll(
    registry.filter((section) => section.channel !== 'injection'),
    input
  )
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
