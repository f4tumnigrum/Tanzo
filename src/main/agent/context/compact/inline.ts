import type { ModelMessage, ToolSet } from 'ai'
import type { TanzoUsageMetadata } from '@shared/agent-message'
import type { AgentDefinition } from '../../agents/types'
import type { ContextEngine } from '../index'
import type { AgentRuntimeDeps, Logger } from '../../runtime/types'
import { estimateModelMessagesTokens } from '../ledger'
import { splitModelTranscript } from './cut'
import { degradeTranscript } from './degrade'
import { runSummarizeFork } from './summarize'
import { stripAnalysis } from './prompt'
import type { CompactionPolicy } from './policy'

export interface InlineCompactionDeps {
  providerService: AgentRuntimeDeps['providerService']
  contextEngine: ContextEngine
  logger?: Logger
}

export interface InlineCompactionInput {
  chatId: string
  def: AgentDefinition
  cwd: string
  runId: string
  transcript: ModelMessage[]
  prompt: string
  policy: CompactionPolicy
  tools?: ToolSet
  abortSignal?: AbortSignal
  onSummary?: (summary: string) => void
}

export interface InlineCompactionResult {
  transcript: ModelMessage[]
  summaryText: string
  afterTokensEstimate: number
  coveredModelMessageCount: number
  usage?: TanzoUsageMetadata
  degraded?: 'prune' | 'drop-oldest'
}

export class ContextHardCeilingError extends Error {
  constructor(actualTokens: number, hardCeilingTokens: number) {
    super(
      `Compaction could not fit the live transcript within the context ceiling ` +
        `(${actualTokens} > ${hardCeilingTokens} estimated tokens).`
    )
    this.name = 'ContextHardCeilingError'
  }
}

function summaryModelMessage(text: string): ModelMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function requireFit(messages: ModelMessage[], hardCeilingTokens: number): number {
  const tokens = estimateModelMessagesTokens(messages)
  if (tokens > hardCeilingTokens) {
    throw new ContextHardCeilingError(tokens, hardCeilingTokens)
  }
  return tokens
}

function degradedSummary(summaryText: string): string {
  return (
    `${summaryText}\n\n` +
    'Additional older conversation content was mechanically elided to fit the context window. ' +
    'Re-read files and re-run searches to recover details you still need.'
  )
}

export async function compactModelTranscript(
  deps: InlineCompactionDeps,
  input: InlineCompactionInput
): Promise<InlineCompactionResult | null> {
  const split = splitModelTranscript(input.transcript, input.policy.retainBudgetTokens)

  if (split) {
    try {
      const fork = await runSummarizeFork(
        {
          providerService: deps.providerService,
          contextEngine: deps.contextEngine,
          ...(deps.logger ? { logger: deps.logger } : {})
        },
        {
          chatId: input.chatId,
          def: input.def,
          cwd: input.cwd,
          runId: input.runId,
          head: split.head,
          prompt: input.prompt,
          ...(input.tools ? { tools: input.tools } : {}),
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          ...(input.onSummary ? { onSummary: input.onSummary } : {})
        }
      )
      const summaryText = stripAnalysis(fork.text)
      if (summaryText) {
        let transcript = [summaryModelMessage(summaryText), ...split.tail]
        let degraded: InlineCompactionResult['degraded']
        if (estimateModelMessagesTokens(transcript) > input.policy.hardCeilingTokens) {
          const fallbackText = degradedSummary(summaryText)
          const fallback = degradeTranscript(
            [summaryModelMessage(fallbackText), ...split.tail],
            input.policy.hardCeilingTokens
          )
          if (!fallback) {
            requireFit(transcript, input.policy.hardCeilingTokens)
          }
          transcript = fallback!.messages
          degraded = fallback!.level
        }
        const afterTokensEstimate = requireFit(transcript, input.policy.hardCeilingTokens)
        return {
          transcript,
          summaryText: degraded ? degradedSummary(summaryText) : summaryText,
          afterTokensEstimate,
          coveredModelMessageCount: degraded ? 0 : split.head.length,
          ...(degraded ? { degraded } : {}),
          ...(fork.usage ? { usage: fork.usage } : {})
        }
      }
      deps.logger?.warn('inline compaction produced empty summary; degrading', {
        chatId: input.chatId
      })
    } catch (error) {
      if (input.abortSignal?.aborted) throw error
      deps.logger?.warn('inline compaction fork failed; degrading', {
        chatId: input.chatId,
        error
      })
    }
  }

  const summaryText =
    'Older conversation content was mechanically elided to fit the context window. ' +
    'Re-read files and re-run searches to recover details you still need.'
  const degraded = degradeTranscript(
    [summaryModelMessage(summaryText), ...input.transcript],
    input.policy.hardCeilingTokens
  )
  if (!degraded) {
    const tokens = estimateModelMessagesTokens(input.transcript)
    if (tokens <= input.policy.hardCeilingTokens) return null
    throw new ContextHardCeilingError(tokens, input.policy.hardCeilingTokens)
  }
  const transcript = degraded.messages
  return {
    transcript,
    summaryText,
    afterTokensEstimate: requireFit(transcript, input.policy.hardCeilingTokens),
    coveredModelMessageCount: 0,
    degraded: degraded.level
  }
}
