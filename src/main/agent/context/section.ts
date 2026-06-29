import type { ModelMessage, SystemModelMessage } from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { GoalInjection } from '@shared/goal'
import type { AgentDefinition } from '../agents/types'
import type { ModelCapabilities } from './capabilities'

export type Stability = 'stable' | 'volatile'

export type SectionChannel = 'system' | 'leading-user'
export type PrefixCacheScope = 'conversation'

export interface BuildInput {
  def: AgentDefinition
  chatId: string
  cwd: string
  capabilities: ModelCapabilities
  goalInjection?: GoalInjection | null
  /** Plugin names the user `@mentioned` this turn, for a focused hint. */
  pluginMention?: string[] | null
}

export interface ContextSection {
  id: string
  stability: Stability
  channel: SectionChannel
  order: number
  prefixCacheScope?: PrefixCacheScope
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
  volatilePrefixUser: ContextMessageProvenance[]
  history: undefined[]
  trailingUser: ContextMessageProvenance[]
  messages: (ContextMessageProvenance | undefined)[]
}

export interface CompiledContext {
  system: SystemModelMessage[]
  stableBoundary: number
  leadingUser: ModelMessage[]
  volatilePrefixUser: ModelMessage[]
  trailingUser: ModelMessage[]
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
