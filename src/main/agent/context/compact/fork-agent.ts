import {
  isStepCount,
  NoOutputGeneratedError,
  streamText,
  type ModelMessage,
  type TelemetryOptions,
  type ToolSet
} from 'ai'
import type { TanzoUsageMetadata } from '@shared/agent-message'
import type { AgentDefinition } from '../../agents/types'
import type { ContextEngine } from '../../context'
import { getContextProvenance } from '../../context/section'
import { hasProviderOptions, resolveLanguageModelConfig } from '../../runtime/model-config'
import {
  recordFinishedStepDiagnostic,
  recordPreparedStepDiagnostic
} from '../../runtime/prompt-diagnostics'
import type { AgentRuntimeDeps, Logger } from '../../runtime/types'
import { extractPartialSummary } from './prompt'

export interface CompactionForkInput {
  chatId: string
  def: AgentDefinition
  cwd: string
  runId: string
  head: ModelMessage[]
  prompt: string
  telemetry?: TelemetryOptions
  abortSignal?: AbortSignal
  onSummary?: (summary: string) => void
}

export type CompactionForkDeps = Omit<AgentRuntimeDeps, 'buildTools'> & {
  /** buildTools is intentionally omitted: the fork runs with toolChoice:'none'
   *  and never calls any tool, so building the full tool set is pure waste. */
  buildTools?: AgentRuntimeDeps['buildTools']
  contextEngine: ContextEngine
  logger?: Logger
}

type UsageLike = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
  reasoningTokens?: number
  cachedInputTokens?: number
}

export interface CompactionForkResult {
  text: string
  usage?: TanzoUsageMetadata
}

const RESPONSE_BODY_PREVIEW_CHARS = 500
const SUMMARY_UPDATE_MIN_INTERVAL_MS = 80
const SUMMARY_UPDATE_MIN_CHARS = 120

function baseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function numberProperty(error: unknown, key: string): number | undefined {
  const value = (error as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function responseHeader(error: unknown, name: string): string | undefined {
  const headers = (error as { responseHeaders?: unknown } | undefined)?.responseHeaders
  if (!headers || typeof headers !== 'object') return undefined
  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== lowerName) continue
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  return undefined
}

function responseBodyPreview(error: unknown): string | undefined {
  const body = (error as { responseBody?: unknown } | undefined)?.responseBody
  if (typeof body !== 'string' || body.length === 0) return undefined
  const compact = body.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length > RESPONSE_BODY_PREVIEW_CHARS
    ? `${compact.slice(0, RESPONSE_BODY_PREVIEW_CHARS)}…`
    : compact
}

function errorMessage(error: unknown): string {
  const message = baseErrorMessage(error)
  const details: string[] = []
  const statusCode = numberProperty(error, 'statusCode') ?? numberProperty(error, 'status')
  if (statusCode !== undefined) details.push(`status ${statusCode}`)
  const contentType = responseHeader(error, 'content-type')
  if (contentType) details.push(`content-type ${contentType}`)
  const body = responseBodyPreview(error)
  if (body) details.push(`response body: ${body}`)
  return details.length > 0 ? `${message} (${details.join('; ')})` : message
}

function isNoOutputGenerated(error: unknown): boolean {
  return NoOutputGeneratedError.isInstance(error)
}

function usageMetadata(usage: UsageLike | undefined): TanzoUsageMetadata | undefined {
  if (!usage) return undefined
  const normalized: TanzoUsageMetadata = {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.outputTokenDetails?.reasoningTokens !== undefined
      ? { reasoningTokens: usage.outputTokenDetails.reasoningTokens }
      : usage.reasoningTokens !== undefined
        ? { reasoningTokens: usage.reasoningTokens }
        : {}),
    ...(usage.inputTokenDetails?.cacheReadTokens !== undefined
      ? { cacheReadTokens: usage.inputTokenDetails.cacheReadTokens }
      : usage.cachedInputTokens !== undefined
        ? { cacheReadTokens: usage.cachedInputTokens }
        : {}),
    ...(usage.inputTokenDetails?.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens }
      : {})
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export async function runCompactionFork(
  deps: CompactionForkDeps,
  input: CompactionForkInput
): Promise<CompactionForkResult> {
  const mode = deps.policy.getMode(deps.store.rootOf(input.chatId))

  // The fork runs with toolChoice:'none' — tools are never invoked.
  // Building the full tool set (MCP servers, registries) is unnecessary overhead,
  // so we skip buildTools entirely and pass an empty set.
  const tools = {} as ToolSet

  const basePrepareStep = async (stepInput: {
    initialMessages: ModelMessage[]
    stepNumber: number
  }) => {
    // stopWhen:isStepCount(1) guarantees exactly one step, so responseMessages
    // is always empty when prepareStep fires. Use initialMessages directly.
    return deps.contextEngine.build(
      input.def,
      input.chatId,
      input.cwd,
      stepInput.initialMessages,
      stepInput.stepNumber,
      { consumeGoalInjection: false }
    )
  }

  // Prefer a dedicated compaction model when configured — compaction is a
  // high-input / low-reasoning task that rarely needs the parent's full model.
  const compactionRef = input.def.compactionModelRef ?? input.def.modelRef
  const modelConfig = resolveLanguageModelConfig(deps.providerService, compactionRef)

  let streamError: unknown
  try {
    let stepUsage: TanzoUsageMetadata | undefined
    let streamedText = ''
    let lastPublishedSummary = ''
    let lastPublishedAt = 0

    const publishSummary = (force: boolean): void => {
      const summary = extractPartialSummary(streamedText)
      if (!summary || summary === lastPublishedSummary) return
      const now = Date.now()
      const grewBy = summary.length - lastPublishedSummary.length
      if (
        !force &&
        now - lastPublishedAt < SUMMARY_UPDATE_MIN_INTERVAL_MS &&
        grewBy < SUMMARY_UPDATE_MIN_CHARS &&
        // Force publish at newline boundaries so the UI updates at paragraph
        // breaks rather than mid-sentence, giving a more readable live preview.
        !summary.endsWith('\n')
      ) {
        return
      }
      input.onSummary?.(summary)
      lastPublishedSummary = summary
      lastPublishedAt = now
    }

    const result = streamText<ToolSet>({
      model: modelConfig.model,
      tools,
      toolChoice: 'none',
      stopWhen: [isStepCount(1)],
      runtimeContext: { chatId: input.chatId, mode },
      ...modelConfig.callSettings,
      ...(hasProviderOptions(modelConfig.providerOptions)
        ? { providerOptions: modelConfig.providerOptions }
        : {}),
      ...(input.telemetry ? { telemetry: input.telemetry } : {}),
      messages: [...input.head, { role: 'user', content: input.prompt }],
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      prepareStep: async (stepInput) => {
        const prepared = await basePrepareStep(stepInput as never)
        recordPreparedStepDiagnostic(deps, {
          chatId: input.chatId,
          runId: input.runId,
          stepNumber: stepInput.stepNumber + 1,
          def: input.def,
          tools,
          prepared: {
            system: prepared?.instructions as never,
            messages: prepared?.messages as never,
            providerOptions: prepared?.providerOptions as Record<string, unknown> | undefined,
            ...(getContextProvenance(prepared)
              ? { provenance: getContextProvenance(prepared)! }
              : {})
          }
        })
        return prepared
      },
      onError: ({ error }) => {
        // The AI SDK only records NoOutputGeneratedError into the rejected
        // promise; every other stream error is passed here and otherwise
        // swallowed, surfacing as the generic "No output generated" message.
        // Capture the first real error so the catch below can report it.
        if (streamError === undefined) streamError = error
      },
      onChunk: ({ chunk }) => {
        if (chunk.type !== 'text-delta') return
        streamedText += chunk.text
        publishSummary(false)
      },
      onStepEnd: (step) => {
        stepUsage = usageMetadata(step.usage)
        recordFinishedStepDiagnostic(deps, {
          chatId: input.chatId,
          runId: input.runId,
          stepNumber: 1,
          usage: step.usage,
          finishReason: step.finishReason,
          providerMetadata: step.providerMetadata
        })
      }
    })
    const text = await result.text
    streamedText = text
    publishSummary(true)
    const normalizedUsage = stepUsage ?? usageMetadata(await result.usage)
    return {
      text,
      ...(normalizedUsage ? { usage: normalizedUsage } : {})
    }
  } catch (error) {
    if (input.abortSignal?.aborted) throw error
    // Prefer the underlying stream error captured by onError: the SDK masks
    // most stream failures as a generic NoOutputGeneratedError at flush time.
    const cause = streamError !== undefined && isNoOutputGenerated(error) ? streamError : error
    throw new Error(`Compaction stream failed: ${errorMessage(cause)}`)
  }
}
