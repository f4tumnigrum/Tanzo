import type { ModelMessage, SystemModelMessage } from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { GoalInjection } from '@shared/goal'
import type { AgentDefinition } from '../agents/types'
import type { ModelCapabilities } from './capabilities'

export type Stability = 'stable' | 'volatile'

/**
 * Section channels (v2):
 * - `system`: rendered into system messages. Must be stable across the steps of
 *   a run (append-only prefix invariant); content changes are only allowed at
 *   turn boundaries.
 * - `leading-user`: merged into a single user message placed before history.
 *   Same stability requirement as `system`.
 * - `injection`: rendered once at turn start and persisted into the transcript
 *   as a synthetic user message (`data-context-injection`). This is how
 *   volatile, per-turn content (datetime, git snapshot, goal nudges, hook
 *   context) reaches the model without breaking the cacheable prefix.
 */
export type SectionChannel = 'system' | 'leading-user' | 'injection'

export interface BuildInput {
  def: AgentDefinition
  chatId: string
  cwd: string
  capabilities: ModelCapabilities
  goalInjection?: GoalInjection | null
  /** Plugin names the user `@mentioned` this turn, for a focused hint. */
  pluginMention?: string[] | null
  /** True when this is the first turn of the conversation. */
  isFirstTurn?: boolean
}

export interface ContextSection {
  id: string
  stability: Stability
  channel: SectionChannel
  order: number
  render(input: BuildInput): string | null | Promise<string | null>
}

export interface ContextSectionProvenance {
  sectionId: string
  stability: Stability
  channel: SectionChannel
}

export interface ContextMessageProvenance {
  sections: ContextSectionProvenance[]
}

export interface ContextPromptProvenance {
  system: ContextSectionProvenance[]
  leadingUser: ContextMessageProvenance[]
  history: undefined[]
  messages: (ContextMessageProvenance | undefined)[]
}

export interface CompiledContext {
  system: SystemModelMessage[]
  /** Count of stable system messages — the provider cache anchor. */
  stableBoundary: number
  leadingUser: ModelMessage[]
  history: ModelMessage[]
  providerOptions?: ProviderOptions
  provenance: Omit<ContextPromptProvenance, 'messages'>
}

export const CONTEXT_PROVENANCE: unique symbol = Symbol('tanzo.contextProvenance')

export function attachContextProvenance<T extends object>(
  value: T,
  provenance: ContextPromptProvenance
): T {
  Object.defineProperty(value, CONTEXT_PROVENANCE, {
    value: provenance,
    enumerable: false
  })
  return value
}

export function getContextProvenance(value: unknown): ContextPromptProvenance | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as { [CONTEXT_PROVENANCE]?: ContextPromptProvenance })[CONTEXT_PROVENANCE]
}
