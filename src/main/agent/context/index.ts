import type { LanguageModelUsage, ModelMessage } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { GoalInjection } from '@shared/goal'
import type { AgentDefinition } from '../agents/types'
import {
  createCapabilities,
  type CapabilitiesFor,
  type ModelCapabilities,
  type ModelMetadataResolver
} from './capabilities'
import { assembleContext, renderSections, type RenderedSection } from './compile'
import { renderContextInjection, renderedSectionIds } from './injection'
import { measureTranscript, type TranscriptMeasure } from './ledger'
import { projectHistory } from './project'
import { createSectionRegistry, type SectionDeps } from './registry'
import { computeCompactionPolicy, type CompactionPolicy } from './compact/policy'
import { strategyFor, type CacheKind } from './providers'
import {
  attachContextProvenance,
  type BuildInput,
  type CompiledContext,
  type ContextSection
} from './section'

export interface ContextEngineDeps extends SectionDeps {
  resolveModelMetadata: ModelMetadataResolver
  extraSections?: ContextSection[]
  /** Sections read the goal; the engine additionally consumes the one-shot
   *  injection state — only when the goal section actually rendered (I6). */
  goal: SectionDeps['goal'] & {
    peekInjection(chatId: string): GoalInjection | null
    takeInjection(chatId: string): GoalInjection | null
  }
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
   * transcript yields the same prompt (append-only prefix invariant). When a
   * runId is given, section rendering is frozen for that run (invariant I7):
   * mid-run changes to instruction files, skills, plan mode, or the goal
   * cannot rewrite the prompt prefix until the next run.
   */
  build(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    transcript: ModelMessage[],
    stepNumber: number,
    runId?: string
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
  const sectionSnapshots = new Map<string, { runId: string; rendered: RenderedSection[] }>()

  /** Run-level section snapshot (I7): first build of a run renders and
   *  freezes; later steps (and the compaction fork, which passes the same
   *  runId for byte-identical prefix reuse) get the frozen snapshot. */
  async function renderForRun(input: BuildInput, runId?: string): Promise<RenderedSection[]> {
    if (!runId) return renderSections(registry, input)
    const cached = sectionSnapshots.get(input.chatId)
    if (cached && cached.runId === runId) return cached.rendered
    const rendered = await renderSections(registry, input)
    sectionSnapshots.set(input.chatId, { runId, rendered })
    return rendered
  }

  async function build(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    transcript: ModelMessage[],
    _stepNumber: number,
    runId?: string
  ): Promise<BuiltContext> {
    void _stepNumber
    const cap = capabilities(def.modelRef)
    const history = projectHistory(transcript, cap)
    const strategy = strategyFor(def.modelRef, chatId)
    const rendered = await renderForRun({ def, chatId, cwd, capabilities: cap }, runId)
    let plan = assembleContext(rendered, history)
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
    // Settle one-shot injection state per section (invariant I6): consume only
    // what actually rendered into the message. A goal cleared between peek and
    // render must not lose its injection to a message that never carried it.
    if (message) {
      const kept = renderedSectionIds(message)
      if (goalInjection && kept.has('goal')) deps.goal.takeInjection(chatId)
      if (pluginMention && pluginMention.length > 0 && kept.has('plugins-mention')) {
        deps.pluginMention.take(chatId)
      }
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
    sectionSnapshots.delete(chatId)
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
