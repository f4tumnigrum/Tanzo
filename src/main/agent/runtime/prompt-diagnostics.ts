import { randomUUID } from 'crypto'
import type { ModelMessage, ToolSet } from 'ai'
import { parseModelRef } from '@shared/provider'
import type { AgentDefinition } from '../agents/types'
import type { ContextPromptProvenance } from '../context/section'
import { buildPromptCacheDiagnostic, stableStringify } from '../diagnostics/prompt-cache'
import type { AgentStore } from '../store-types'
import type { Logger } from './types'
import type { UsageLike } from './stream-runner'

export interface PromptDiagnosticDeps {
  store: AgentStore
  logger?: Logger
}

export type PromptDiagnosticMode = 'off' | 'sampled' | 'full'

// In `sampled` mode we still record the first step (baseline for the cache-key diff)
// and then every Nth step, which keeps the O(context) hashing off most steps of long runs.
const SAMPLED_STEP_INTERVAL = 4

function resolveMode(): PromptDiagnosticMode {
  const raw = process.env.TANZO_PROMPT_DIAGNOSTICS?.trim().toLowerCase()
  if (raw === 'off' || raw === 'sampled' || raw === 'full') return raw
  return 'full'
}

let cachedMode: PromptDiagnosticMode | undefined

export function promptDiagnosticMode(): PromptDiagnosticMode {
  if (cachedMode === undefined) cachedMode = resolveMode()
  return cachedMode
}

// Test seam: allow resetting the memoized mode after mutating the env var.
export function resetPromptDiagnosticModeCache(): void {
  cachedMode = undefined
}

function shouldRecordPrepared(mode: PromptDiagnosticMode, stepNumber: number): boolean {
  if (mode === 'off') return false
  if (mode === 'full') return true
  // sampled: stepNumber here is 1-based (stepNumber + 1 at the call site).
  return stepNumber <= 1 || stepNumber % SAMPLED_STEP_INTERVAL === 0
}

export interface PreparedDiagnosticInput {
  system?: ModelMessage[]
  messages?: ModelMessage[]
  providerOptions?: Record<string, unknown>
  provenance?: ContextPromptProvenance
}

export function recordPreparedStepDiagnostic(
  deps: PromptDiagnosticDeps,
  input: {
    chatId: string
    runId: string
    stepNumber: number
    def: AgentDefinition
    tools: ToolSet
    prepared: PreparedDiagnosticInput
  }
): void {
  const mode = promptDiagnosticMode()
  const createdAt = Date.now()
  if (!shouldRecordPrepared(mode, input.stepNumber)) {
    // Still create the run/step rows so token accounting and markRunOutcome work,
    // but skip the expensive prompt hashing + segment diff.
    if (mode === 'off') return
    try {
      deps.store.ensureRunStep({
        conversationId: input.chatId,
        runId: input.runId,
        stepNumber: input.stepNumber,
        modelRef: input.def.modelRef,
        provider: parseModelRef(input.def.modelRef)?.providerId ?? '',
        createdAt
      })
    } catch (error) {
      deps.logger?.warn('prompt diagnostic run-step ensure failed', {
        chatId: input.chatId,
        runId: input.runId,
        stepNumber: input.stepNumber,
        error
      })
    }
    return
  }
  try {
    deps.store.recordPromptDiagnostic(
      buildPromptCacheDiagnostic({
        id: randomUUID(),
        conversationId: input.chatId,
        runId: input.runId,
        stepNumber: input.stepNumber,
        createdAt,
        def: input.def,
        tools: input.tools,
        prepared: input.prepared,
        previous: deps.store.getLatestPromptDiagnostic(input.chatId)
      })
    )
  } catch (error) {
    deps.logger?.warn('prompt cache diagnostic record failed', {
      chatId: input.chatId,
      runId: input.runId,
      stepNumber: input.stepNumber,
      error
    })
  }
}

export function recordFinishedStepDiagnostic(
  deps: PromptDiagnosticDeps,
  input: {
    chatId: string
    runId: string
    stepNumber: number
    usage?: UsageLike
    finishReason?: string
    providerMetadata?: Record<string, unknown>
  }
): void {
  // In `off` mode no run/step row exists to update; token accounting is disabled.
  if (promptDiagnosticMode() === 'off') return
  try {
    deps.store.finishPromptDiagnostic({
      conversationId: input.chatId,
      runId: input.runId,
      stepNumber: input.stepNumber,
      usageJson: input.usage ? stableStringify(input.usage) : undefined,
      finishReason: input.finishReason,
      providerMetadataJson: input.providerMetadata
        ? stableStringify(input.providerMetadata)
        : undefined,
      inputTokens: input.usage?.inputTokens,
      outputTokens: input.usage?.outputTokens,
      totalTokens: input.usage?.totalTokens,
      cacheReadTokens:
        input.usage?.inputTokenDetails?.cacheReadTokens ?? input.usage?.cachedInputTokens,
      cacheWriteTokens: input.usage?.inputTokenDetails?.cacheWriteTokens
    })
  } catch (error) {
    deps.logger?.warn('prompt cache diagnostic finish failed', {
      chatId: input.chatId,
      runId: input.runId,
      stepNumber: input.stepNumber,
      error
    })
  }
}
