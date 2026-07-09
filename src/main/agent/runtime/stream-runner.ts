import { randomUUID } from 'crypto'
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  toUIMessageStream,
  type ModelMessage,
  type ToolSet
} from 'ai'
import { getErrorMessage } from '@ai-sdk/provider'
import type { ChatRunError, ChatRunStatus } from '@shared/chat'
import { ERROR_CODES } from '@shared/errors'
import type { AgentTelemetryError } from '../telemetry/events'
import type {
  SubagentTraceEntry,
  TanzoMetadata,
  TanzoStepUsageMetadata,
  TanzoUIMessage,
  TanzoUsageMetadata
} from '@shared/agent-message'
import type { AgentDefinition } from '../agents/types'
import type { ContextEngine } from '../context'
import { getContextProvenance } from '../context/section'
import { canonicalizeToolTranscript } from '../context/tool-transcript'
import { compactModelTranscript } from '../context/compact/inline'
import type { ChatKeyedQueue } from './chat-keyed-queue'
import type { InlineCompactionRecord } from './compaction-coordinator'
import { compactionPrompt } from './compaction-coordinator'
import { createAgentTelemetry } from '../telemetry'
import { createDbTelemetrySink } from '../telemetry/sinks'
import type { AgentRuntimeDeps, GoalRuntime, Logger } from './types'
import type { SkillsStore } from '../skills/types'
import { buildAgentCall } from './build-agent'
import { resolvePastedTextPointers } from './pasted-text'
import { recordFinishedStepDiagnostic, recordPreparedStepDiagnostic } from './prompt-diagnostics'
import { toolKeyMatchesPattern } from '../tools/registry'

export type UsageLike = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  outputTokenDetails?: { reasoningTokens?: number }
  reasoningTokens?: number
  cachedInputTokens?: number
}

export interface AgentStreamRunnerDeps extends AgentRuntimeDeps {
  skills?: SkillsStore
  logger?: Logger
  contextEngine?: ContextEngine
  goal?: GoalRuntime
}

export interface AgentStreamFinalState {
  latestUsage?: UsageLike
  producedToolCall: boolean
  producedWorkToolCall: boolean
  streamFailed: boolean
  streamError?: string
  streamErrorCode?: string
  streamErrorDetail?: AgentTelemetryError
  aborted: boolean
  turnStartedAt: number
  lastFinishReason?: string
  ttftMs?: number
  retryCount?: number

  inlineCompaction?: InlineCompactionRecord
  isGoalContinuation: boolean
  exitPlanModeCalled: boolean
  endedWithTextOnly: boolean

  worktreeChanged?: boolean | null
}

export function streamStatus(state: AgentStreamFinalState): Exclude<ChatRunStatus, 'running'> {
  if (state.aborted) return 'aborted'
  if (state.streamFailed) return 'failed'
  return 'finished'
}

export function terminalRunError(state: AgentStreamFinalState): ChatRunError | undefined {
  if (!state.streamFailed) return undefined
  return {
    code: state.streamErrorCode ?? ERROR_CODES.CHAT_RUN_FAILED,
    message: state.streamError ?? 'The model stream failed.'
  }
}

function chatRunErrorCode(kind: AgentTelemetryError['kind']): string {
  switch (kind) {
    case 'api':
    case 'retry':
      return ERROR_CODES.AISDK_API_CALL_ERROR
    case 'validation':
      return ERROR_CODES.AISDK_INVALID_RESPONSE
    case 'model':
      return ERROR_CODES.AISDK_NO_SUCH_MODEL
    default:
      return ERROR_CODES.CHAT_RUN_FAILED
  }
}

interface StartAgentStreamInput {
  chatId: string
  def: AgentDefinition
  messages: TanzoUIMessage[]
  depth: number
  broadcast: boolean
  runId: string
  signal: AbortSignal
  steerQueue: ChatKeyedQueue<string>
  recordConsumedSteering?: (messages: TanzoUIMessage[], stepNumber: number) => void
  persistStepMessages?: (messages: TanzoUIMessage[]) => Promise<boolean> | boolean | void
  persistFinalMessages?: (
    messages: TanzoUIMessage[],
    state: { streamFailed: boolean }
  ) => Promise<boolean> | boolean | void
  onTrace?: (entry: SubagentTraceEntry) => void
  onFinally: (state: AgentStreamFinalState) => Promise<void> | void
  isGoalContinuation?: boolean
  forceExitPlanMode?: boolean
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

function stepUsageMetadata(
  stepNumber: number,
  part: {
    usage?: UsageLike
    finishReason?: string
    providerMetadata?: Record<string, unknown>
  }
): TanzoStepUsageMetadata {
  return {
    stepNumber,
    usage: usageMetadata(part.usage) ?? null,
    finishReason: part.finishReason ?? null,
    providerMetadata: part.providerMetadata ?? null
  }
}

function messageUsageMetadata(input: {
  steps: TanzoStepUsageMetadata[]
  usage?: TanzoUsageMetadata
}): TanzoMetadata | undefined {
  const metadata: TanzoMetadata = {}
  if (input.steps.length > 0) metadata.steps = [...input.steps]
  if (input.usage) metadata.usage = input.usage
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function readSkillAllowedTools(output: unknown): string[] {
  if (typeof output !== 'object' || output === null) return []
  const record = output as { allowedTools?: unknown; error?: unknown }
  if (record.error === true || !Array.isArray(record.allowedTools)) return []
  return record.allowedTools.filter(
    (tool): tool is string => typeof tool === 'string' && tool.length > 0
  )
}

function collectSkillToolPatterns(messages: ModelMessage[]): string[] {
  const patterns = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if ((part as { type?: string }).type !== 'tool-result') continue
      const result = part as {
        toolName?: string
        output?: { type?: string; value?: unknown }
      }
      if (result.toolName !== 'skill' || result.output?.type !== 'json') continue
      for (const pattern of readSkillAllowedTools(result.output.value)) patterns.add(pattern)
    }
  }
  return [...patterns]
}

function resolveActiveTools(patterns: string[], tools: ToolSet): string[] {
  if (patterns.length === 0) return []
  return Object.keys(tools).filter((key) =>
    patterns.some((pattern) => toolKeyMatchesPattern(key, pattern))
  )
}

function skillActiveTools(messages: ModelMessage[], tools: ToolSet): string[] | undefined {
  const activeTools = resolveActiveTools(collectSkillToolPatterns(messages), tools)
  return activeTools.length > 0 ? activeTools : undefined
}

function isUsageLimitError(error: unknown): boolean {
  const record = error as { statusCode?: unknown; status?: unknown; message?: unknown } | null
  if (record?.statusCode === 429 || record?.status === 429) return true
  const message = typeof record?.message === 'string' ? record.message.toLowerCase() : ''
  return /rate limit|quota|usage limit|too many requests/.test(message)
}

const OVERHEAD_TOOL_NAMES = new Set(['updateGoal', 'todo'])

function toolMeta(tools: ToolSet, toolName: string): { kind?: string; workSignal?: boolean } {
  const tool = tools[toolName] as
    { metadata?: { tanzo?: { kind?: unknown; workSignal?: unknown } } } | undefined
  const tanzo = tool?.metadata?.tanzo
  return {
    ...(typeof tanzo?.kind === 'string' ? { kind: tanzo.kind } : {}),
    ...(typeof tanzo?.workSignal === 'boolean' ? { workSignal: tanzo.workSignal } : {})
  }
}

function isWorkToolCall(tools: ToolSet, toolName: string): boolean {
  if (OVERHEAD_TOOL_NAMES.has(toolName)) return false
  const meta = toolMeta(tools, toolName)

  if (meta.workSignal !== undefined) return meta.workSignal
  return meta.kind === 'edit' || meta.kind === 'exec'
}

export function startAgentStream(
  deps: AgentStreamRunnerDeps,
  opts: StartAgentStreamInput
): {
  stream: AsyncIterable<unknown>
} {
  let latestUsage: UsageLike | undefined
  let turnUsage: UsageLike | undefined
  let streamFailed = false
  let streamError: string | undefined
  let streamErrorCode: string | undefined
  let streamErrorDetail: AgentTelemetryError | undefined

  let rawStreamError: unknown
  let producedToolCall = false
  let producedWorkToolCall = false
  let exitPlanModeCalled = false
  let lastStepHadToolCall = false
  let lastFinishReason: string | undefined
  let hookRequestedStop = false
  let inlineCompaction: InlineCompactionRecord | undefined
  const turnStartedAt = Date.now()
  const telemetry = createAgentTelemetry({
    runId: opts.runId,
    chatId: opts.chatId,
    scope: 'chat',
    send: deps.send,
    broadcast: opts.broadcast,
    sinks: [
      createDbTelemetrySink({ store: deps.store, ...(deps.logger ? { logger: deps.logger } : {}) })
    ],
    ...(deps.logger ? { logger: deps.logger } : {})
  })

  const stream = createUIMessageStream<TanzoUIMessage>({
    originalMessages: opts.messages,
    execute: async ({ writer }) => {
      let stepCounter = 0
      const aggregatedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      const stepUsages: TanzoStepUsageMetadata[] = []
      const rootChatId = deps.store.rootOf(opts.chatId)
      const mode = deps.policy.getMode(rootChatId)
      const conversation = deps.store.getConversation(opts.chatId)
      const cwd = conversation?.cwd ?? process.cwd()
      const tools = await deps.buildTools({
        def: opts.def,
        chatId: opts.chatId,
        depth: opts.depth,
        mode,
        messages: opts.messages,
        runId: opts.runId
      })
      const compactionPolicy = deps.contextEngine?.compactionPolicy(opts.def)

      const goalBudget = (() => {
        if (!opts.broadcast || !deps.goal) return undefined
        if (conversation?.parentConversationId) return undefined
        const goal = deps.goal.get(opts.chatId)
        if (!goal || goal.userState !== 'active' || goal.outcome || goal.limit) return undefined
        const remainingTokens =
          goal.tokenBudget != null ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : undefined
        const remainingSeconds =
          goal.timeBudgetSeconds != null
            ? Math.max(0, goal.timeBudgetSeconds - goal.timeUsedSeconds)
            : undefined
        if (remainingTokens === undefined && remainingSeconds === undefined) return undefined
        return {
          ...(remainingTokens !== undefined ? { remainingTokens } : {}),
          ...(remainingSeconds !== undefined ? { remainingSeconds } : {})
        }
      })()
      const agentCall = buildAgentCall({
        def: opts.def,
        chatId: opts.chatId,
        mode,
        providerService: deps.providerService,
        tools,
        decide: deps.policy.decide,
        shouldStop: () => hookRequestedStop,
        telemetry: telemetry.options,
        ...(conversation?.reasoningEffort ? { reasoningEffort: conversation.reasoningEffort } : {}),
        ...(goalBudget ? { goalBudget } : {}),
        ...(opts.forceExitPlanMode
          ? { toolChoice: { type: 'tool' as const, toolName: 'exitPlanMode' } }
          : {})
      })

      const initialMessages = canonicalizeToolTranscript(
        await convertToModelMessages(resolvePastedTextPointers(opts.messages), {
          tools,
          ignoreIncompleteToolCalls: true
        })
      )

      let rebasedBase: ModelMessage[] | null = null
      let responseCountAtRebase = 0
      let lastStepInputTokens = 0

      const shouldCompactInline = (): boolean => {
        if (!compactionPolicy || !deps.contextEngine) return false
        return lastStepInputTokens > compactionPolicy.compactionTriggerTokens
      }

      const result = streamText<ToolSet>({
        model: agentCall.model,
        tools: agentCall.tools,
        toolOrder: agentCall.toolOrder as never,
        runtimeContext: agentCall.runtimeContext,
        toolApproval: agentCall.toolApproval,
        stopWhen: agentCall.stopWhen,
        ...agentCall.callSettings,
        ...(agentCall.providerOptions ? { providerOptions: agentCall.providerOptions } : {}),
        ...(agentCall.telemetry ? { telemetry: agentCall.telemetry } : {}),
        ...(agentCall.toolChoice ? { toolChoice: agentCall.toolChoice } : {}),
        ...(agentCall.headers ? { headers: agentCall.headers } : {}),
        messages: initialMessages,
        abortSignal: opts.signal,
        // Keep this callback synchronous and O(1): the SDK pauses stream processing
        // until it resolves, so any async/heavy work here would throttle streaming.
        onChunk: () => {
          telemetry.recordChunk()
        },
        onError: ({ error }) => {
          if (rawStreamError === undefined) rawStreamError = error
        },
        prepareStep: async ({ responseMessages, stepNumber }) => {
          const liveResponses = (responseMessages as ModelMessage[]).slice(
            rebasedBase ? responseCountAtRebase : 0
          )
          const base = rebasedBase ?? initialMessages
          let transcript = canonicalizeToolTranscript([...base, ...liveResponses])

          const steers = opts.steerQueue.drain(opts.chatId)
          if (steers.length > 0) {
            opts.recordConsumedSteering?.(
              steers.map<TanzoUIMessage>((text) => ({
                id: randomUUID(),
                role: 'user',
                parts: [{ type: 'text', text }]
              })),
              stepNumber
            )

            transcript = [
              ...transcript,
              ...steers.map<ModelMessage>((text) => ({ role: 'user', content: text }))
            ]
            rebasedBase = transcript
            responseCountAtRebase = (responseMessages as ModelMessage[]).length
          }

          if (deps.contextEngine && compactionPolicy && shouldCompactInline()) {
            try {
              const compacted = await compactModelTranscript(
                {
                  providerService: deps.providerService,
                  contextEngine: deps.contextEngine,
                  ...(deps.logger ? { logger: deps.logger } : {})
                },
                {
                  chatId: opts.chatId,
                  def: opts.def,
                  cwd,
                  runId: opts.runId,
                  transcript,
                  prompt: compactionPrompt(opts.def),
                  policy: compactionPolicy,
                  tools,
                  abortSignal: opts.signal,
                  onSummary: (summary) => {
                    if (!opts.broadcast) return
                    deps.send(
                      opts.chatId,
                      {
                        type: 'data-compaction',
                        id: `compaction:inline:${opts.runId}`,
                        data: { stage: 'start', auto: true, summary },
                        transient: true
                      },
                      { runId: opts.runId }
                    )
                  }
                }
              )
              if (compacted) {
                transcript = compacted.transcript
                rebasedBase = compacted.transcript
                responseCountAtRebase = (responseMessages as ModelMessage[]).length

                lastStepInputTokens = 0
                inlineCompaction = {
                  summaryText: compacted.summaryText,
                  baseMessageIds: opts.messages.map((message) => message.id),
                  ...(compacted.usage ? { usage: compacted.usage } : {}),
                  ...(compacted.degraded ? { degraded: compacted.degraded } : {})
                }
                if (opts.broadcast) {
                  deps.send(
                    opts.chatId,
                    {
                      type: 'data-compaction',
                      id: `compaction:inline:${opts.runId}`,
                      data: {
                        stage: 'complete',
                        auto: true,
                        summary: compacted.summaryText,
                        afterTokens: compacted.afterTokensEstimate,
                        ...(compacted.degraded ? { degraded: compacted.degraded } : {})
                      },
                      transient: true
                    },
                    { runId: opts.runId }
                  )
                }
              }
            } catch (error) {
              if (opts.signal.aborted) throw error
              deps.logger?.warn('in-stream compaction failed; continuing uncompacted', {
                chatId: opts.chatId,
                error
              })
            }
          }

          const built = await deps.contextEngine?.build(
            opts.def,
            opts.chatId,
            cwd,
            transcript,
            stepNumber,
            opts.runId
          )
          if (!built) return undefined
          const messages = canonicalizeToolTranscript(built.messages as ModelMessage[])
          const activeTools = skillActiveTools(messages, tools)
          const provenance = getContextProvenance(built)
          recordPreparedStepDiagnostic(deps, {
            chatId: opts.chatId,
            runId: opts.runId,
            stepNumber: stepNumber + 1,
            def: opts.def,
            tools,
            prepared: {
              system: built.instructions as never,
              messages: built.messages as never,
              providerOptions: built.providerOptions as Record<string, unknown> | undefined,
              ...(provenance ? { provenance } : {})
            }
          })
          return {
            instructions: built.instructions,
            messages,
            ...(activeTools ? { activeTools } : {}),
            ...(built.providerOptions ? { providerOptions: built.providerOptions } : {})
          }
        },
        onStepEnd: async (step) => {
          latestUsage = step.usage
          lastStepInputTokens = step.usage?.inputTokens ?? 0
          lastFinishReason = step.finishReason
          stepCounter += 1
          deps.contextEngine?.observeStep(opts.chatId, step.usage)
          recordFinishedStepDiagnostic(deps, {
            chatId: opts.chatId,
            runId: opts.runId,
            stepNumber: stepCounter,
            usage: step.usage,
            finishReason: step.finishReason,
            providerMetadata: step.providerMetadata
          })
          lastStepHadToolCall = step.toolCalls.length > 0
          if (step.toolCalls.length > 0) {
            producedToolCall = true
            if (step.toolCalls.some((call) => isWorkToolCall(tools, call.toolName))) {
              producedWorkToolCall = true
            }
            if (step.toolCalls.some((call) => call.toolName === 'exitPlanMode')) {
              exitPlanModeCalled = true
            }
          }
          if (deps.hooks && step.toolResults.length > 0) {
            for (const toolResult of step.toolResults) {
              const outcome = await deps.hooks
                .runPostToolUse({
                  chatId: opts.chatId,
                  toolName: toolResult.toolName,
                  toolInput: toolResult.input,
                  toolResponse: toolResult.output,
                  toolUseId: toolResult.toolCallId
                })
                .catch((error): { stopped: boolean; stopReason?: string } => {
                  deps.logger?.warn('PostToolUse hook failed', { chatId: opts.chatId, error })
                  return { stopped: false }
                })
              if (outcome.stopped) {
                hookRequestedStop = true
                if (outcome.stopReason) {
                  deps.logger?.info('PostToolUse hook stopped turn', {
                    chatId: opts.chatId,
                    reason: outcome.stopReason
                  })
                }
              }
            }
          }
          if (opts.onTrace) {
            const text = step.text.trim()
            if (text) opts.onTrace({ type: 'text', text })
            for (const call of step.toolCalls) {
              opts.onTrace({ type: 'tool', toolName: call.toolName })
            }
          }
        }
      })

      writer.merge(
        toUIMessageStream<ToolSet, TanzoUIMessage>({
          stream: result.stream,
          onError: getErrorMessage,
          messageMetadata: ({ part }) => {
            if (part.type === 'finish-step') {
              stepUsages.push(stepUsageMetadata(stepUsages.length + 1, part))
              return messageUsageMetadata({ steps: stepUsages })
            }
            if (part.type !== 'finish') return undefined
            const usage = part.totalUsage
            aggregatedUsage.inputTokens += usage?.inputTokens ?? 0
            aggregatedUsage.outputTokens += usage?.outputTokens ?? 0
            aggregatedUsage.totalTokens += usage?.totalTokens ?? 0
            turnUsage = { ...aggregatedUsage }
            return messageUsageMetadata({
              steps: stepUsages,
              usage: usageMetadata(turnUsage)
            })
          }
        })
      )
    },
    onStepEnd: async ({ messages }) => {
      await opts.persistStepMessages?.(messages)
    },
    onEnd: async ({ messages }) => {
      await opts.persistFinalMessages?.(messages, { streamFailed })
    },
    onError: (error) => {
      streamFailed = true
      const cause = rawStreamError ?? error
      const message = getErrorMessage(cause)
      streamError = message
      const event = telemetry.emitError(cause)
      if (event.error) {
        streamErrorDetail = event.error
        streamErrorCode = chatRunErrorCode(event.error.kind)
      }
      deps.logger?.warn('chat stream failed', { chatId: opts.chatId, error: event.error })
      if (opts.broadcast && isUsageLimitError(cause)) deps.goal?.markUsageLimited(opts.chatId)
      return message
    }
  })

  const drain = async function* (): AsyncIterable<unknown> {
    try {
      for await (const chunk of stream) {
        if (opts.broadcast) deps.send(opts.chatId, chunk, { runId: opts.runId })
        yield chunk
      }
    } finally {
      const aborted = opts.signal.aborted
      const finalUsage = turnUsage ?? latestUsage
      await opts.onFinally({
        ...(finalUsage ? { latestUsage: finalUsage } : {}),
        producedToolCall,
        producedWorkToolCall,
        streamFailed,
        ...(streamError ? { streamError } : {}),
        ...(streamErrorCode ? { streamErrorCode } : {}),
        ...(streamErrorDetail ? { streamErrorDetail } : {}),
        ...(telemetry.ttftMs() !== undefined ? { ttftMs: telemetry.ttftMs() } : {}),
        retryCount: telemetry.retryCount(),
        aborted,
        turnStartedAt,
        ...(lastFinishReason ? { lastFinishReason } : {}),
        ...(inlineCompaction ? { inlineCompaction } : {}),
        isGoalContinuation: opts.isGoalContinuation ?? false,
        exitPlanModeCalled,
        endedWithTextOnly: !aborted && !streamFailed && !lastStepHadToolCall
      })
    }
  }

  return { stream: drain() }
}
