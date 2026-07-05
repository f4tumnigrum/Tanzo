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

/**
 * Render the `system` and `leading-user` channels (v2). Split from assembly so
 * the engine can freeze the rendered sections for the duration of a run
 * (invariant I7): section stability becomes structural, not declarative — a
 * mid-run AGENTS.md edit, skill toggle, or goal change cannot rewrite the
 * prompt prefix until the next run.
 */
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

/**
 * Assemble rendered sections plus canonicalized history into the compiled
 * plan. Pure with respect to the rendered snapshot — the same snapshot and
 * history yield the same prompt (append-only prefix invariant).
 */
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

/**
 * Compile the `system` and `leading-user` channels in one step (no snapshot).
 * `injection` channel sections are rendered separately (see injection.ts) and
 * persisted into the transcript.
 */
export async function compileSections(
  registry: ContextSection[],
  input: BuildInput,
  history: ModelMessage[]
): Promise<CompiledContext> {
  return assembleContext(await renderSections(registry, input), history)
}
