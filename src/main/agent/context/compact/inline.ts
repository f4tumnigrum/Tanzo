import type { ModelMessage, ToolSet } from 'ai'
import type { TanzoUsageMetadata } from '@shared/agent-message'
import type { AgentDefinition } from '../../agents/types'
import type { ContextEngine } from '../index'
import type { AgentRuntimeDeps, Logger } from '../../runtime/types'
import { estimateModelMessagesTokens, estimateTextTokens } from '../ledger'
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
  usage?: TanzoUsageMetadata
  degraded?: 'prune' | 'drop-oldest'
}

function summaryModelMessage(text: string): ModelMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
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
        const transcript = [summaryModelMessage(summaryText), ...split.tail]
        return {
          transcript,
          summaryText,
          afterTokensEstimate:
            estimateTextTokens(summaryText) + estimateModelMessagesTokens(split.tail),
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

  const degraded = degradeTranscript(input.transcript, input.policy.hardCeilingTokens)
  if (!degraded) return null
  const summaryText =
    'Older conversation content was mechanically elided to fit the context window. ' +
    'Re-read files and re-run searches to recover details you still need.'
  const transcript = [summaryModelMessage(summaryText), ...degraded.messages]
  return {
    transcript,
    summaryText,
    afterTokensEstimate: estimateModelMessagesTokens(transcript),
    degraded: degraded.level
  }
}
