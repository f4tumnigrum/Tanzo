import type { LanguageModelUsage, ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { AgentDefinition } from '../agents/types'
import {
  createCapabilities,
  type CapabilitiesFor,
  type ModelCapabilities,
  type ModelMetadataResolver
} from './capabilities'
import { compileSections } from './compile'
import { renderContextInjection } from './injection'
import { measureTranscript, type TranscriptMeasure } from './ledger'
import { projectHistory } from './project'
import { createSectionRegistry, type SectionDeps } from './registry'
import { computeCompactionPolicy, type CompactionPolicy } from './compact/policy'
import { strategyFor, type CacheKind } from './providers'
import { attachContextProvenance, type CompiledContext, type ContextSection } from './section'

export interface ContextEngineDeps extends SectionDeps {
  resolveModelMetadata: ModelMetadataResolver
  extraSections?: ContextSection[]
}

export interface ContextSnapshot {
  usedTokens?: number
  windowTokens: number
  compactionTriggerTokens: number
  compactionTriggered: boolean
  source: 'unavailable' | 'reported' | 'estimated'
  cacheKind: CacheKind
  serverCompaction: boolean
  hitRatio?: number
}

export interface BuiltContext {
  instructions: CompiledContext['system']
  messages: ModelMessage[]
  providerOptions?: CompiledContext['providerOptions']
}

export interface ContextEngine {
  /**
   * Assemble the per-step prompt: system sections + leading-user block +
   * canonicalized history. Pure with respect to per-chat state — the same
   * transcript yields the same prompt (append-only prefix invariant).
   */
  build(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    transcript: ModelMessage[],
    stepNumber: number
  ): Promise<BuiltContext>
  /**
   * Render the volatile per-turn injection (datetime, git snapshot, goal,
   * plugin focus, hook context) as a persistable synthetic user message.
   * Consumes one-shot injection state (goal injection, plugin mentions).
   */
  renderInjection(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    options: { isFirstTurn: boolean }
  ): Promise<TanzoUIMessage | null>
  /** Ledger-based measurement of a persisted transcript. */
  measure(def: AgentDefinition, chatId: string, messages: TanzoUIMessage[]): TranscriptMeasure
  shouldCompact(def: AgentDefinition, chatId: string, messages: TanzoUIMessage[]): boolean
  snapshot(def: AgentDefinition, chatId: string, messages: TanzoUIMessage[]): ContextSnapshot
  compactionPolicy(def: AgentDefinition): CompactionPolicy
  capabilitiesFor(modelRef: string): ModelCapabilities
  /** Record step usage for cache hit-ratio reporting. */
  observeStep(chatId: string, usage: LanguageModelUsage | undefined): void
  clear(chatId: string): void
}

function cacheHitRatio(usage: LanguageModelUsage | undefined): number | undefined {
  const input = usage?.inputTokens
  const cached = usage?.inputTokenDetails?.cacheReadTokens
  if (input == null || input <= 0 || cached == null) return undefined
  return cached / input
}

/**
 * After compaction the transcript is `[summary, ...tail]`, so a compaction
 * summary — when present — is always the first history message and the only
 * assistant message a transcript can start with.
 */
function summaryIndexOf(history: ModelMessage[]): number {
  return history[0]?.role === 'assistant' ? 0 : -1
}

export function createContextEngine(deps: ContextEngineDeps): ContextEngine {
  const registry: ContextSection[] = [...createSectionRegistry(deps), ...(deps.extraSections ?? [])]
  const capabilities: CapabilitiesFor = createCapabilities(deps.resolveModelMetadata)
  const lastUsage = new Map<string, LanguageModelUsage>()

  async function build(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    transcript: ModelMessage[],
    _stepNumber: number
  ): Promise<BuiltContext> {
    void _stepNumber
    const cap = capabilities(def.modelRef)
    const history = projectHistory(transcript, cap)
    const strategy = strategyFor(def.modelRef, chatId)
    let plan = await compileSections(registry, { def, chatId, cwd, capabilities: cap }, history)
    plan = strategy.applyCaching({ plan, summaryIndex: summaryIndexOf(history) })
    return attachContextProvenance(
      {
        instructions: plan.system,
        messages: [...plan.leadingUser, ...plan.history],
        ...(plan.providerOptions ? { providerOptions: plan.providerOptions } : {})
      },
      {
        system: plan.provenance.system,
        leadingUser: plan.provenance.leadingUser,
        history: plan.provenance.history,
        messages: [...plan.provenance.leadingUser, ...plan.provenance.history]
      }
    )
  }

  async function renderInjection(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    options: { isFirstTurn: boolean }
  ): Promise<TanzoUIMessage | null> {
    const cap = capabilities(def.modelRef)
    const goalInjection = deps.goal.peekInjection(chatId)
    const pluginMention = deps.pluginMention.peek(chatId)
    const message = await renderContextInjection(registry, {
      def,
      chatId,
      cwd,
      capabilities: cap,
      goalInjection,
      pluginMention,
      isFirstTurn: options.isFirstTurn
    })
    if (message) {
      if (goalInjection) deps.goal.takeInjection(chatId)
      if (pluginMention && pluginMention.length > 0) deps.pluginMention.take(chatId)
    }
    return message
  }

  function measure(
    _def: AgentDefinition,
    _chatId: string,
    messages: TanzoUIMessage[]
  ): TranscriptMeasure {
    void _def
    void _chatId
    return measureTranscript(messages)
  }

  function compactionPolicy(def: AgentDefinition): CompactionPolicy {
    return computeCompactionPolicy(capabilities(def.modelRef))
  }

  function shouldCompact(
    def: AgentDefinition,
    chatId: string,
    messages: TanzoUIMessage[]
  ): boolean {
    return (
      measure(def, chatId, messages).totalTokens > compactionPolicy(def).compactionTriggerTokens
    )
  }

  function snapshot(
    def: AgentDefinition,
    chatId: string,
    messages: TanzoUIMessage[]
  ): ContextSnapshot {
    const cap = capabilities(def.modelRef)
    const policy = compactionPolicy(def)
    const usage = measure(def, chatId, messages)
    const strategy = strategyFor(def.modelRef, chatId)
    return {
      usedTokens: usage.totalTokens,
      windowTokens: cap.contextWindow,
      compactionTriggerTokens: policy.compactionTriggerTokens,
      compactionTriggered: usage.totalTokens > policy.compactionTriggerTokens,
      source: usage.source,
      cacheKind: strategy.cacheKind,
      serverCompaction: false,
      hitRatio: cacheHitRatio(lastUsage.get(chatId))
    }
  }

  function observeStep(chatId: string, usage: LanguageModelUsage | undefined): void {
    if (!usage?.inputTokens) return
    lastUsage.set(chatId, usage)
  }

  function clear(chatId: string): void {
    lastUsage.delete(chatId)
  }

  return {
    build,
    renderInjection,
    measure,
    shouldCompact,
    snapshot,
    compactionPolicy,
    capabilitiesFor: (modelRef) => capabilities(modelRef),
    observeStep,
    clear
  }
}

export type { CompactionPolicy }
