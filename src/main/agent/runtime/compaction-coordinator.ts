import { randomUUID } from 'crypto'
import type { ToolSet } from 'ai'
import type { TanzoDataParts, TanzoUIMessage, TanzoUsageMetadata } from '@shared/agent-message'
import type { CompactionOutcome } from '@shared/chat'
import { TanzoError } from '@shared/errors'
import type { AgentDefinition } from '../agents/types'
import type { ContextEngine } from '../context'
import {
  buildCompactionResult,
  buildSummaryMessage,
  planCompaction,
  type CompactionPlan
} from '../context/compact/compact'
import { COMPACT_PROMPT } from '../context/compact/prompt'
import { runSummarizeFork } from '../context/compact/summarize'
import { createAgentTelemetry } from '../telemetry'
import { createDbTelemetrySink } from '../telemetry/sinks'
import type { AgentRuntimeDeps, Logger } from './types'

export type CompactionRunLifecycle = <T>(
  chatId: string,
  runId: string,
  baseMessages: TanzoUIMessage[],
  executor: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal
) => Promise<T>

export interface InlineCompactionRecord {
  summaryText: string

  /** Ordered, contiguous UI-message prefix fully covered by the inline summary. */
  baseMessageIds: string[]
  usage?: TanzoUsageMetadata
  degraded?: 'prune' | 'drop-oldest'
}

export interface CompactionCoordinator {
  prepareMessages(
    chatId: string,
    def: AgentDefinition,
    incoming: TanzoUIMessage[],
    runId: string,
    options?: { signal?: AbortSignal }
  ): Promise<TanzoUIMessage[]>

  reconcileInline(
    chatId: string,
    def: AgentDefinition,
    inline: InlineCompactionRecord,
    options?: { signal?: AbortSignal }
  ): Promise<boolean>

  compact(chatId: string, options?: { instructions?: string }): Promise<CompactionOutcome>
}

export function compactionPrompt(def: AgentDefinition, instructions?: string): string {
  const parts = [COMPACT_PROMPT]
  const agentInstructions = def.compactionInstructions?.trim()
  if (agentInstructions) parts.push(`Agent-specific compaction guidance:\n${agentInstructions}`)
  const userInstructions = instructions?.trim()
  if (userInstructions)
    parts.push(`Additional user instructions for this compaction:\n${userInstructions}`)
  return parts.join('\n\n')
}

function withoutStepUsageAnchors(messages: TanzoUIMessage[]): TanzoUIMessage[] {
  return messages.map((message) => {
    if (!message.metadata?.steps?.some((step) => step.usage)) return message
    return {
      ...message,
      metadata: {
        ...message.metadata,
        steps: message.metadata.steps.map((step) => ({ ...step, usage: null }))
      }
    }
  })
}

export function createCompactionCoordinator(
  deps: AgentRuntimeDeps & {
    logger?: Logger
    contextEngine?: ContextEngine
    runLifecycle?: CompactionRunLifecycle
  }
): CompactionCoordinator {
  const pendingByChat = new Map<string, Promise<unknown>>()
  const lifecycle: CompactionRunLifecycle =
    deps.runLifecycle ??
    function defaultLifecycle<T>(
      chatId: string,
      _runId: string,
      _messages: TanzoUIMessage[],
      executor: (signal: AbortSignal) => Promise<T>,
      parentSignal?: AbortSignal
    ): Promise<T> {
      const signal = parentSignal ?? new AbortController().signal
      const prev = pendingByChat.get(chatId) ?? Promise.resolve()
      const run = prev.catch(() => undefined).then(() => executor(signal))
      pendingByChat.set(chatId, run as Promise<unknown>)
      run.finally(() => {
        if (pendingByChat.get(chatId) === (run as Promise<unknown>)) pendingByChat.delete(chatId)
      })
      return run
    }

  function publishCompactionStatus(
    chatId: string,
    runId: string,
    data: TanzoDataParts['compaction'],
    frameRunId?: string
  ): void {
    deps.send(
      chatId,
      {
        type: 'data-compaction',
        id: `compaction:${data.summaryId ?? runId}`,
        data,
        transient: true
      },
      frameRunId ? { runId: frameRunId } : undefined
    )
  }

  function publishContextSnapshot(
    chatId: string,
    def: AgentDefinition,
    engine: ContextEngine,
    next: TanzoUIMessage[],
    frameRunId?: string
  ): void {
    try {
      deps.send(
        chatId,
        {
          type: 'data-context',
          id: `context:${chatId}`,
          data: engine.snapshot(def, chatId, next),
          transient: true
        },
        frameRunId ? { runId: frameRunId } : undefined
      )
    } catch (error) {
      deps.logger?.warn('compaction context snapshot publish failed', { chatId, error })
    }
  }

  interface FinalizeInput {
    plan: CompactionPlan
    summary: TanzoUIMessage
    next: TanzoUIMessage[]
    expectedActiveMessages: TanzoUIMessage[]
    auto: boolean
    summaryId: string
    runId: string
    frameRunId?: string
  }

  async function finalize(
    chatId: string,
    def: AgentDefinition,
    engine: ContextEngine,
    input: FinalizeInput
  ): Promise<{ outcome: CompactionOutcome; next: TanzoUIMessage[] | null }> {
    try {
      deps.store.finalizeCompaction(
        chatId,
        input.plan.archivedIds,
        input.summary.id,
        input.next,
        input.expectedActiveMessages,
        input.plan.head
      )
    } catch (error) {
      if (error instanceof TanzoError && error.code === 'CHAT_COMPACTION_STALE') {
        deps.logger?.warn('compaction skipped: conversation changed while compacting', { chatId })
        publishCompactionStatus(
          chatId,
          input.runId,
          {
            stage: 'failed',
            auto: input.auto,
            summaryId: input.summaryId,
            summary: 'Conversation changed during compaction; nothing was archived.'
          },
          input.frameRunId
        )
        const fresh = await deps.store.load(chatId)
        return { outcome: 'stale', next: fresh }
      }
      deps.logger?.warn('compaction failed', { chatId, error })
      publishCompactionStatus(
        chatId,
        input.runId,
        {
          stage: 'failed',
          auto: input.auto,
          summaryId: input.summaryId,
          summary: error instanceof Error ? error.message : String(error)
        },
        input.frameRunId
      )
      throw error
    }

    engine.clear(chatId)
    const summaryData = input.summary.parts.find((part) => part.type === 'data-compaction')
    if (summaryData?.type === 'data-compaction') {
      publishCompactionStatus(chatId, input.runId, summaryData.data, input.frameRunId)
    }
    publishContextSnapshot(chatId, def, engine, input.next, input.frameRunId)
    deps.logger?.info('compacted conversation', { chatId })
    return { outcome: 'compacted', next: input.next }
  }

  async function runCompaction(
    chatId: string,
    def: AgentDefinition,
    auto: boolean,
    options: { signal?: AbortSignal; runId?: string; tools?: ToolSet; instructions?: string }
  ): Promise<{ outcome: CompactionOutcome; next: TanzoUIMessage[] | null }> {
    const engine = deps.contextEngine
    if (!engine) return { outcome: 'not-needed', next: null }

    const incoming = await deps.store.load(chatId)
    const policy = engine.compactionPolicy(def)
    const preplanned = auto ? await planCompaction(incoming, policy.retainBudgetTokens) : undefined
    if (auto && !preplanned) return { outcome: 'not-needed', next: null }
    if (options.signal?.aborted) return { outcome: 'aborted', next: null }

    const summaryId = randomUUID()
    const runId = options.runId ?? randomUUID()
    const compactionRunId = `${runId}:compaction:${summaryId}`

    const execute = async (
      signal: AbortSignal
    ): Promise<{ outcome: CompactionOutcome; next: TanzoUIMessage[] | null }> => {
      const plan = preplanned ?? (await planCompaction(incoming, policy.retainBudgetTokens))
      if (signal.aborted) return { outcome: 'aborted', next: null }
      if (!plan) return { outcome: 'not-needed', next: null }

      const telemetry = createAgentTelemetry({
        runId: compactionRunId,
        chatId,
        scope: 'compaction',
        send: deps.send,
        broadcast: true,
        sinks: [
          createDbTelemetrySink({
            store: deps.store,
            ...(deps.logger ? { logger: deps.logger } : {})
          })
        ],
        ...(deps.logger ? { logger: deps.logger } : {})
      })
      publishCompactionStatus(chatId, runId, { stage: 'start', auto, summaryId }, compactionRunId)

      let summary: TanzoUIMessage
      let next: TanzoUIMessage[]
      try {
        const forkResult = await runSummarizeFork(
          {
            providerService: deps.providerService,
            contextEngine: engine,
            ...(deps.logger ? { logger: deps.logger } : {})
          },
          {
            chatId,
            def,
            cwd: deps.store.getConversation(chatId)?.cwd ?? process.cwd(),
            runId: compactionRunId,
            head: plan.sourceMessages,
            prompt: compactionPrompt(def, options.instructions),
            ...(options.tools ? { tools: options.tools } : {}),
            telemetry: telemetry.options,
            abortSignal: signal,
            onSummary: (partial) => {
              publishCompactionStatus(
                chatId,
                runId,
                { stage: 'start', auto, summaryId, summary: partial },
                compactionRunId
              )
            }
          }
        )
        if (signal.aborted) return { outcome: 'aborted', next: null }
        const result = buildCompactionResult({
          plan,
          summaryText: forkResult.text,
          summaryId,
          auto,
          ...(forkResult.usage ? { usage: forkResult.usage } : {})
        })
        summary = result.summary
        next = result.next
      } catch (error) {
        if (signal.aborted) return { outcome: 'aborted', next: null }

        deps.logger?.warn('compaction fork failed; using mechanical fallback', { chatId, error })
        summary = mechanicalSummary(plan, auto, summaryId)
        next = [summary, ...plan.tail]
      }

      const nextTokens = engine.measure(def, chatId, withoutStepUsageAnchors(next)).totalTokens
      if (nextTokens > policy.hardCeilingTokens) {
        const message =
          `Compaction could not fit the conversation within the context ceiling ` +
          `(${nextTokens} > ${policy.hardCeilingTokens} estimated tokens).`
        publishCompactionStatus(
          chatId,
          runId,
          { stage: 'failed', auto, summaryId, summary: message },
          compactionRunId
        )
        throw new Error(message)
      }

      return finalize(chatId, def, engine, {
        plan,
        summary,
        next,
        expectedActiveMessages: incoming,
        auto,
        summaryId,
        runId,
        frameRunId: compactionRunId
      })
    }

    return lifecycle(chatId, compactionRunId, incoming, execute, options.signal)
  }

  function mechanicalSummary(
    plan: CompactionPlan,
    auto: boolean,
    summaryId: string
  ): TanzoUIMessage {
    const lines: string[] = [
      'Summarization was unavailable; older conversation content was archived mechanically.',
      `Archived ${plan.head.length} message(s). Key user messages from the archived range:`
    ]
    let remainingChars = 2_000
    for (const message of plan.head) {
      if (message.role !== 'user') continue
      const text = message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (!text || remainingChars <= 0) continue
      const excerpt = text.slice(0, Math.min(400, remainingChars))
      lines.push(`- ${excerpt}`)
      remainingChars -= excerpt.length
    }
    lines.push('Re-read files and re-run searches to recover any details you still need.')
    return buildSummaryMessage({
      summaryText: lines.join('\n'),
      summaryId,
      auto,
      omittedMessages: plan.head.length,
      degraded: 'prune'
    })
  }

  return {
    async prepareMessages(chatId, def, incoming, runId, options) {
      const engine = deps.contextEngine
      if (!engine) return incoming
      if (!engine.shouldCompact(def, chatId, incoming)) return incoming
      const result = await runCompaction(chatId, def, true, {
        runId,
        ...(options?.signal ? { signal: options.signal } : {})
      })
      return result.next ?? incoming
    },

    async reconcileInline(chatId, def, inline, options) {
      const engine = deps.contextEngine
      if (!engine) return false
      if (options?.signal?.aborted) return false
      if (!deps.store.getConversation(chatId)) return false
      if (inline.baseMessageIds.length === 0) return false

      const incoming = await deps.store.load(chatId)
      if (options?.signal?.aborted) return false
      if (inline.baseMessageIds.length >= incoming.length) return false
      for (let i = 0; i < inline.baseMessageIds.length; i += 1) {
        if (incoming[i]?.id !== inline.baseMessageIds[i]) return false
      }

      const head = incoming.slice(0, inline.baseMessageIds.length)
      const tail = incoming.slice(inline.baseMessageIds.length)
      const plan: CompactionPlan = {
        head,
        tail,
        archivedIds: [...inline.baseMessageIds],
        sourceMessages: []
      }
      const summary = buildSummaryMessage({
        summaryText: inline.summaryText,
        auto: true,
        omittedMessages: head.length,
        ...(inline.usage ? { usage: inline.usage } : {}),
        ...(inline.usage?.inputTokens !== undefined
          ? { beforeTokens: inline.usage.inputTokens }
          : {}),
        ...(inline.degraded ? { degraded: inline.degraded } : {})
      })
      const next = [summary, ...tail]
      const policy = engine.compactionPolicy(def)
      const nextTokens = engine.measure(def, chatId, withoutStepUsageAnchors(next)).totalTokens
      if (nextTokens > policy.hardCeilingTokens) {
        deps.logger?.warn('inline compaction reconciliation exceeds context ceiling', {
          chatId,
          nextTokens,
          hardCeilingTokens: policy.hardCeilingTokens
        })
        return false
      }

      const runId = randomUUID()
      const signal = options?.signal ?? new AbortController().signal
      if (signal.aborted) return false
      const result = await finalize(chatId, def, engine, {
        plan,
        summary,
        next,
        expectedActiveMessages: incoming,
        auto: true,
        summaryId: summary.id,
        runId
      })
      return result.outcome === 'compacted'
    },

    async compact(chatId, options) {
      const def = await deps.store.resolveAgentDefinition(chatId)
      const result = await runCompaction(chatId, def, false, {
        ...(options?.instructions ? { instructions: options.instructions } : {})
      })
      return result.outcome
    }
  }
}
