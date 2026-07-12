import {
  isStepCount,
  NoOutputGeneratedError,
  streamText,
  type ModelMessage,
  type SystemModelMessage,
  type TelemetryOptions,
  type ToolSet
} from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { requireModelRef } from '@shared/provider'
import type { TanzoUsageMetadata } from '@shared/agent-message'
import type { AgentDefinition } from '../../agents/types'
import type { ContextEngine } from '../index'
import { estimateModelMessagesTokens, estimateTextTokens } from '../ledger'
import { mergeProviderOptionsInto } from '../../../provider/options'
import { conversationRequestHeaders } from '../../../provider/request-headers'
import { hasProviderOptions, resolveLanguageModelConfig } from '../../runtime/model-config'
import type { AgentRuntimeDeps, Logger } from '../../runtime/types'
import { extractPartialSummary } from './prompt'

export interface SummarizeForkInput {
  chatId: string
  def: AgentDefinition
  cwd: string
  runId: string
  head: ModelMessage[]
  prompt: string

  tools?: ToolSet
  telemetry?: TelemetryOptions
  abortSignal?: AbortSignal
  onSummary?: (summary: string) => void
}

export interface SummarizeForkDeps {
  providerService: AgentRuntimeDeps['providerService']
  contextEngine: ContextEngine
  logger?: Logger
}

export interface SummarizeForkResult {
  text: string
  usage?: TanzoUsageMetadata
}

const SUMMARIZER_SYSTEM =
  'You are a summarization engine. You receive an engineering conversation transcript and ' +
  'produce a faithful, information-dense summary following the instructions at the end. ' +
  'Output only the summary text.'

const FORK_BUDGET_FRACTION = 0.8
const CHUNK_FRACTION = 0.6
const ROLLING_RESERVE_FRACTION = 0.2
const PAYLOAD_TOKEN_MARGIN = 8

const CONTINUE_SUMMARY_PROMPT =
  'Update the summary to cover everything above. Preserve exact identifiers, file paths, and user intent. Output only the updated summary.'
const PAYLOAD_SEPARATOR = '\n\n---\n\n'

const RESPONSE_BODY_PREVIEW_CHARS = 500
const SUMMARY_UPDATE_MIN_INTERVAL_MS = 80
const SUMMARY_UPDATE_MIN_CHARS = 120

type UsageLike = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
  reasoningTokens?: number
  cachedInputTokens?: number
}

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

function responseBodyPreview(error: unknown): string | undefined {
  const body = (error as { responseBody?: unknown } | undefined)?.responseBody
  if (typeof body !== 'string' || body.length === 0) return undefined
  const compact = body.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length > RESPONSE_BODY_PREVIEW_CHARS
    ? `${compact.slice(0, RESPONSE_BODY_PREVIEW_CHARS)}…`
    : compact
}

export function forkErrorMessage(error: unknown): string {
  const message = baseErrorMessage(error)
  const details: string[] = []
  const statusCode = numberProperty(error, 'statusCode') ?? numberProperty(error, 'status')
  if (statusCode !== undefined) details.push(`status ${statusCode}`)
  const body = responseBodyPreview(error)
  if (body) details.push(`response body: ${body}`)
  return details.length > 0 ? `${message} (${details.join('; ')})` : message
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

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const out: string[] = []
  for (const part of content) {
    const record = part as { type?: string; text?: unknown; toolName?: string; input?: unknown }
    if (typeof record.text === 'string') {
      out.push(record.text)
    } else if (record.type === 'tool-call') {
      let input = ''
      try {
        input = JSON.stringify(record.input)
      } catch {
        input = '[unserializable input]'
      }
      out.push(`[tool call: ${record.toolName ?? 'unknown'} ${input}]`)
    } else if (record.type === 'tool-result') {
      const output = (record as { output?: { value?: unknown } }).output?.value
      out.push(
        `[tool result: ${record.toolName ?? 'unknown'}]\n${
          typeof output === 'string' ? output : JSON.stringify(output ?? null)
        }`
      )
    }
  }
  return out.join('\n')
}

export function renderTranscriptText(messages: ModelMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    const text = contentToText(message.content).trim()
    if (!text) continue
    lines.push(`## ${message.role}\n${text}`)
  }
  return lines.join('\n\n')
}

function splitTextToBudget(text: string, budgetTokens: number): string[] {
  const chunks: string[] = []
  let offset = 0
  while (offset < text.length) {
    let low = offset + 1
    let high = Math.min(text.length, offset + Math.max(budgetTokens * 4, 1))
    let end = offset
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (estimateTextTokens(text.slice(offset, mid)) <= budgetTokens) {
        end = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    if (end === offset) end = offset + 1
    chunks.push(text.slice(offset, end))
    offset = end
  }
  return chunks
}

function truncateTextToBudget(text: string, budgetTokens: number): string {
  if (budgetTokens <= 0) return ''
  if (estimateTextTokens(text) <= budgetTokens) return text

  const marker = '\n...[rolling summary truncated to fit the summarizer context]...'
  const contentBudget = budgetTokens - estimateTextTokens(marker) - 1
  if (contentBudget <= 0) return splitTextToBudget(text, budgetTokens)[0] ?? ''
  const prefix = splitTextToBudget(text, contentBudget)[0] ?? ''
  const truncated = `${prefix}${marker}`
  return estimateTextTokens(truncated) <= budgetTokens ? truncated : prefix
}

function chunkTranscript(messages: ModelMessage[], chunkBudgetTokens: number): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let currentTokens = 0
  for (const message of messages) {
    const text = contentToText(message.content).trim()
    if (!text) continue
    const header = `## ${message.role}\n`
    const bodyBudget = Math.max(chunkBudgetTokens - estimateTextTokens(header), 1)
    for (const piece of splitTextToBudget(text, bodyBudget)) {
      const block = `${header}${piece}`
      const tokens = estimateTextTokens(block)
      if (currentTokens + tokens > chunkBudgetTokens && current.length > 0) {
        chunks.push(current.join('\n\n'))
        current = []
        currentTokens = 0
      }
      current.push(block)
      currentTokens += tokens
    }
  }
  if (current.length > 0) chunks.push(current.join('\n\n'))
  return chunks
}

interface StreamSummaryCall {
  model: ReturnType<typeof resolveLanguageModelConfig>
  instructions?: SystemModelMessage[] | string
  messages: ModelMessage[]
  tools?: ToolSet
  toolChoice?: 'none'
  providerOptions?: ProviderOptions
  telemetry?: TelemetryOptions
  abortSignal?: AbortSignal
  onSummary?: (summary: string) => void
  headers?: Record<string, string>
}

async function streamSummary(call: StreamSummaryCall): Promise<SummarizeForkResult> {
  let streamError: unknown
  let streamedText = ''
  let lastPublishedSummary = ''
  let lastPublishedAt = 0

  const publishSummary = (force: boolean): void => {
    if (!call.onSummary) return
    const summary = extractPartialSummary(streamedText)
    if (!summary || summary === lastPublishedSummary) return
    const now = Date.now()
    const grewBy = summary.length - lastPublishedSummary.length
    if (
      !force &&
      now - lastPublishedAt < SUMMARY_UPDATE_MIN_INTERVAL_MS &&
      grewBy < SUMMARY_UPDATE_MIN_CHARS &&
      !summary.endsWith('\n')
    ) {
      return
    }
    call.onSummary(summary)
    lastPublishedSummary = summary
    lastPublishedAt = now
  }

  try {
    let stepUsage: TanzoUsageMetadata | undefined
    const mergedProviderOptions = mergeProviderOptionsInto(
      call.model.providerOptions,
      call.providerOptions ?? {}
    )
    const result = streamText<ToolSet>({
      model: call.model.model,
      ...(call.tools ? { tools: call.tools } : {}),
      ...(call.toolChoice ? { toolChoice: call.toolChoice } : {}),
      ...(call.instructions ? { instructions: call.instructions } : {}),
      stopWhen: [isStepCount(1)],

      ...(call.model.callSettings.maxRetries !== undefined
        ? { maxRetries: call.model.callSettings.maxRetries }
        : {}),
      ...(hasProviderOptions(mergedProviderOptions)
        ? { providerOptions: mergedProviderOptions }
        : {}),
      ...(call.model.reasoning ? { reasoning: call.model.reasoning } : {}),
      ...(call.telemetry ? { telemetry: call.telemetry } : {}),
      ...(call.headers ? { headers: call.headers } : {}),
      messages: call.messages,
      ...(call.abortSignal ? { abortSignal: call.abortSignal } : {}),
      onError: ({ error }) => {
        if (streamError === undefined) streamError = error
      },
      onChunk: ({ chunk }) => {
        if (chunk.type !== 'text-delta') return
        streamedText += chunk.text
        publishSummary(false)
      },
      onStepEnd: (step) => {
        stepUsage = usageMetadata(step.usage)
      }
    })
    const text = await result.text
    streamedText = text
    publishSummary(true)
    const usage = stepUsage ?? usageMetadata(await result.usage)
    return { text, ...(usage ? { usage } : {}) }
  } catch (error) {
    if (call.abortSignal?.aborted) throw error
    const cause =
      streamError !== undefined && NoOutputGeneratedError.isInstance(error) ? streamError : error
    throw new Error(`Compaction stream failed: ${forkErrorMessage(cause)}`)
  }
}

function providerOf(modelRef: string): string {
  return requireModelRef(modelRef).providerId
}

function withoutExecute(tools: ToolSet): ToolSet {
  const out: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    const clone = { ...(tool as Record<string, unknown>) }
    delete clone.execute
    delete clone.onInputAvailable
    delete clone.onInputStart
    delete clone.onInputDelta
    out[name] = clone as ToolSet[string]
  }
  return out
}

export async function runSummarizeFork(
  deps: SummarizeForkDeps,
  input: SummarizeForkInput
): Promise<SummarizeForkResult> {
  const forkRef = input.def.compactionModelRef ?? input.def.modelRef
  const forkCap = deps.contextEngine.capabilitiesFor(forkRef)
  const forkBudget = Math.floor(
    Math.max(forkCap.contextWindow - forkCap.maxOutputTokens, 1) * FORK_BUDGET_FRACTION
  )
  const headTokens = estimateModelMessagesTokens(input.head) + estimateTextTokens(input.prompt)
  const modelConfig = resolveLanguageModelConfig(deps.providerService, forkRef)

  if (!input.def.compactionModelRef && input.tools && headTokens <= forkBudget) {
    const built = await deps.contextEngine.build(
      input.def,
      input.chatId,
      input.cwd,
      input.head,
      0,
      input.runId
    )

    const anthropic = providerOf(input.def.modelRef) === 'anthropic'
    // This fork reuses the live conversation prefix, so the conv-id header lets
    // Grok route it to the server holding that cached prefix.
    const convHeaders = conversationRequestHeaders(
      requireModelRef(forkRef).providerId,
      input.chatId
    )
    return streamSummary({
      model: modelConfig,
      ...(built.instructions.length > 0 ? { instructions: built.instructions } : {}),
      messages: [...built.messages, { role: 'user', content: input.prompt }],
      tools: withoutExecute(input.tools),
      ...(anthropic ? {} : { toolChoice: 'none' as const }),
      ...(built.providerOptions ? { providerOptions: built.providerOptions } : {}),
      ...(input.telemetry ? { telemetry: input.telemetry } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(convHeaders ? { headers: convHeaders } : {}),
      ...(input.onSummary ? { onSummary: input.onSummary } : {})
    })
  }

  const summarizerInstructions: SystemModelMessage[] = [
    { role: 'system', content: SUMMARIZER_SYSTEM }
  ]

  if (headTokens <= forkBudget) {
    return streamSummary({
      model: modelConfig,
      instructions: summarizerInstructions,
      messages: [
        { role: 'user', content: `${renderTranscriptText(input.head)}\n\n---\n\n${input.prompt}` }
      ],
      ...(input.telemetry ? { telemetry: input.telemetry } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(input.onSummary ? { onSummary: input.onSummary } : {})
    })
  }

  const payloadBudget =
    forkBudget - estimateModelMessagesTokens(summarizerInstructions as ModelMessage[])
  if (payloadBudget <= 0) {
    throw new Error('Summarizer instructions exceed the compaction context budget')
  }
  const maxInstructionTokens = Math.max(
    estimateTextTokens(input.prompt),
    estimateTextTokens(CONTINUE_SUMMARY_PROMPT)
  )
  const framingTokens =
    estimateTextTokens('Summary of the conversation so far:\n') +
    estimateTextTokens('Transcript continues:\n') +
    estimateTextTokens(PAYLOAD_SEPARATOR) * 2 +
    PAYLOAD_TOKEN_MARGIN
  const rollingReserve = Math.floor(payloadBudget * ROLLING_RESERVE_FRACTION)
  const availableForChunk = payloadBudget - maxInstructionTokens - framingTokens - rollingReserve
  if (availableForChunk <= 0) {
    throw new Error('Compaction instructions exceed the summarizer context budget')
  }
  const chunkBudget = Math.max(
    1,
    Math.min(Math.floor(payloadBudget * CHUNK_FRACTION), availableForChunk)
  )
  const chunks = chunkTranscript(input.head, chunkBudget)
  let rolling = ''
  let aggregateInput = 0
  let lastUsage: TanzoUsageMetadata | undefined
  for (let i = 0; i < chunks.length; i += 1) {
    if (input.abortSignal?.aborted) throw new Error('Compaction aborted')
    const isFinal = i === chunks.length - 1
    const instruction = isFinal ? input.prompt : CONTINUE_SUMMARY_PROMPT
    const fixedParts = [`Transcript continues:\n${chunks[i]}`, instruction]
    const fixedPayload = fixedParts.join(PAYLOAD_SEPARATOR)
    if (estimateTextTokens(fixedPayload) > payloadBudget) {
      throw new Error('A compaction transcript chunk exceeds the summarizer context budget')
    }

    const parts: string[] = []
    if (rolling) {
      const rollingFrameTokens =
        estimateTextTokens('Summary of the conversation so far:\n') +
        estimateTextTokens(PAYLOAD_SEPARATOR) +
        PAYLOAD_TOKEN_MARGIN
      const rollingBudget = Math.max(
        payloadBudget - estimateTextTokens(fixedPayload) - rollingFrameTokens,
        0
      )
      const fittedRolling = truncateTextToBudget(rolling, rollingBudget)
      if (fittedRolling) {
        parts.push(`Summary of the conversation so far:\n${fittedRolling}`)
      }
    }
    parts.push(...fixedParts)
    const payload = parts.join(PAYLOAD_SEPARATOR)
    if (estimateTextTokens(payload) > payloadBudget) {
      throw new Error('Rolling compaction summary exceeds the summarizer context budget')
    }
    const result = await streamSummary({
      model: modelConfig,
      instructions: summarizerInstructions,
      messages: [{ role: 'user', content: payload }],
      ...(input.telemetry ? { telemetry: input.telemetry } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(isFinal && input.onSummary ? { onSummary: input.onSummary } : {})
    })
    rolling = result.text
    aggregateInput += result.usage?.inputTokens ?? 0
    lastUsage = result.usage
  }
  const usage: TanzoUsageMetadata | undefined = lastUsage
    ? { ...lastUsage, inputTokens: aggregateInput }
    : undefined
  return { text: rolling, ...(usage ? { usage } : {}) }
}
