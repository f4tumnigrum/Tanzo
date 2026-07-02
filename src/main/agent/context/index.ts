import type { LanguageModelUsage, ModelMessage } from 'ai'
import type { AgentDefinition } from '../agents/types'
import { createBudget, cacheHitRatio, type Budget } from './budget'
import {
  createCapabilities,
  type CapabilitiesFor,
  type ModelMetadataResolver
} from './capabilities'
import { compileSections } from './compile'
import { projectHistory } from './project'
import { createSectionRegistry, type SectionDeps } from './registry'
import { computeCompactionPolicy, type CompactionPolicy } from './compaction-policy'
import { strategyFor, type CacheKind } from './providers'
import {
  attachContextProvenance,
  type CompiledContext,
  type ContextMessageProvenance,
  type ContextSection
} from './section'

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

export interface ContextEnginePrepareOptions {
  consumeGoalInjection?: boolean
  consumePluginMention?: boolean
}

export interface BuiltContext {
  instructions: CompiledContext['system']
  messages: ModelMessage[]
  providerOptions?: CompiledContext['providerOptions']
}

export interface ContextEngine {
  build(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    transcript: ModelMessage[],
    stepNumber: number,
    options?: ContextEnginePrepareOptions
  ): Promise<BuiltContext>
  observeStep(chatId: string, messageCount: number, usage: LanguageModelUsage | undefined): void
  snapshot(def: AgentDefinition, chatId: string, messages: ModelMessage[]): ContextSnapshot
  shouldCompact(def: AgentDefinition, chatId: string, messages: ModelMessage[]): boolean
  compactionTriggerTokens(def: AgentDefinition): number
  retainedRecentSteps(def: AgentDefinition): number
  clear(chatId: string): void
}

function promptMessages(plan: CompiledContext, stepNumber: number): ModelMessage[] {
  return [
    ...plan.leadingUser,
    ...plan.history,
    ...(stepNumber === 0 ? [...plan.volatilePrefixUser, ...plan.trailingUser] : [])
  ]
}

function promptMessageProvenance(
  plan: CompiledContext,
  stepNumber: number
): (ContextMessageProvenance | undefined)[] {
  return [
    ...plan.provenance.leadingUser,
    ...plan.provenance.history,
    ...(stepNumber === 0
      ? [...plan.provenance.volatilePrefixUser, ...plan.provenance.trailingUser]
      : [])
  ]
}

interface FrozenVolatilePrefix {
  messages: ModelMessage[]
  provenance: ContextMessageProvenance[]
}

function withFrozenVolatilePrefix(
  plan: CompiledContext,
  frozen: FrozenVolatilePrefix
): CompiledContext {
  return {
    ...plan,
    leadingUser: [...plan.leadingUser, ...frozen.messages],
    volatilePrefixUser: [],
    provenance: {
      ...plan.provenance,
      leadingUser: [...plan.provenance.leadingUser, ...frozen.provenance],
      volatilePrefixUser: []
    }
  }
}

export function createContextEngine(deps: ContextEngineDeps): ContextEngine {
  const registry: ContextSection[] = [...createSectionRegistry(deps), ...(deps.extraSections ?? [])]
  const budget: Budget = createBudget()
  const capabilitiesFor: CapabilitiesFor = createCapabilities(deps.resolveModelMetadata)
  const lastUsage = new Map<string, LanguageModelUsage>()
  const frozenVolatilePrefixes = new Map<string, FrozenVolatilePrefix>()

  function resolve(def: AgentDefinition, chatId: string) {
    const capabilities = capabilitiesFor(def.modelRef)
    const compactionPolicy = computeCompactionPolicy(capabilities)
    const strategy = strategyFor(def.modelRef, chatId)
    return { capabilities, compactionPolicy, strategy }
  }

  async function compilePlan(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    history: ModelMessage[],
    turnIndex: number,
    options: ContextEnginePrepareOptions
  ): Promise<CompiledContext> {
    const { strategy } = resolve(def, chatId)
    const capabilities = capabilitiesFor(def.modelRef)
    const goalInjection =
      turnIndex === 0 && options.consumeGoalInjection !== false
        ? deps.goal.peekInjection(chatId)
        : null
    const pluginMention =
      turnIndex === 0 && options.consumePluginMention !== false
        ? deps.pluginMention.peek(chatId)
        : null

    let plan = await compileSections(
      registry,
      { def, chatId, cwd, capabilities, goalInjection, pluginMention },
      history
    )

    plan =
      strategy.applyPromptLayout?.(plan, {
        freezeVolatilePrefix: (layoutPlan) => {
          let frozen = frozenVolatilePrefixes.get(chatId)
          if (!frozen) {
            frozen = {
              messages: layoutPlan.volatilePrefixUser,
              provenance: layoutPlan.provenance.volatilePrefixUser
            }
            frozenVolatilePrefixes.set(chatId, frozen)
          }
          return withFrozenVolatilePrefix(layoutPlan, frozen)
        }
      }) ?? plan
    plan = strategy.applyCaching(plan)
    if (goalInjection) deps.goal.takeInjection(chatId)
    if (pluginMention && pluginMention.length > 0) deps.pluginMention.take(chatId)
    return plan
  }

  function planToBuilt(plan: CompiledContext, turnIndex: number): BuiltContext {
    return attachContextProvenance(
      {
        instructions: plan.system,
        messages: promptMessages(plan, turnIndex),
        ...(plan.providerOptions ? { providerOptions: plan.providerOptions } : {})
      },
      {
        system: plan.provenance.system,
        leadingUser: plan.provenance.leadingUser,
        volatilePrefixUser: plan.provenance.volatilePrefixUser,
        history: plan.provenance.history,
        trailingUser: plan.provenance.trailingUser,
        messages: promptMessageProvenance(plan, turnIndex)
      }
    )
  }

  async function build(
    def: AgentDefinition,
    chatId: string,
    cwd: string,
    transcript: ModelMessage[],
    stepNumber: number,
    options: ContextEnginePrepareOptions = {}
  ): Promise<BuiltContext> {
    const { capabilities } = resolve(def, chatId)
    const history = projectHistory(transcript, capabilities)
    const plan = await compilePlan(def, chatId, cwd, history, stepNumber, options)
    return planToBuilt(plan, stepNumber)
  }

  function observeStep(
    chatId: string,
    messageCount: number,
    usage: LanguageModelUsage | undefined
  ): void {
    if (!usage?.inputTokens) return
    budget.anchor(chatId, messageCount, usage.inputTokens)
    lastUsage.set(chatId, usage)
  }

  function snapshot(
    def: AgentDefinition,
    chatId: string,
    messages: ModelMessage[]
  ): ContextSnapshot {
    const { capabilities, compactionPolicy, strategy } = resolve(def, chatId)
    const usage = budget.measureUsage(chatId, messages)
    return {
      ...(usage.inputTokens !== undefined ? { usedTokens: usage.inputTokens } : {}),
      windowTokens: capabilities.contextWindow,
      compactionTriggerTokens: compactionPolicy.compactionTriggerTokens,
      compactionTriggered: usage.exceeds(compactionPolicy.compactionTriggerTokens),
      source: usage.source,
      cacheKind: strategy.cacheKind,
      serverCompaction: false,
      hitRatio: cacheHitRatio(lastUsage.get(chatId))
    }
  }

  function shouldCompact(def: AgentDefinition, chatId: string, messages: ModelMessage[]): boolean {
    const { compactionPolicy } = resolve(def, chatId)
    return budget.measureUsage(chatId, messages).exceeds(compactionPolicy.compactionTriggerTokens)
  }

  function compactionTriggerTokens(def: AgentDefinition): number {
    return resolve(def, '').compactionPolicy.compactionTriggerTokens
  }

  function retainedRecentSteps(def: AgentDefinition): number {
    return resolve(def, '').compactionPolicy.retainedRecentSteps
  }

  function clear(chatId: string): void {
    budget.clear(chatId)
    lastUsage.delete(chatId)
    frozenVolatilePrefixes.delete(chatId)
  }

  return {
    build,
    observeStep,
    snapshot,
    shouldCompact,
    compactionTriggerTokens,
    retainedRecentSteps,
    clear
  }
}

export type { CompactionPolicy }
