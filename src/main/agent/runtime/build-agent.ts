import {
  isStepCount,
  type ModelMessage,
  type StopCondition,
  type TelemetryOptions,
  type ToolChoice,
  type ToolSet
} from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { AgentDefinition } from '../agents/types'
import type { PermissionMode } from '@shared/policy'
import type { ProviderService } from '../../provider/service'
import type { PolicyEngine, ToolPolicyKind } from '../policy/types'
import { hasProviderOptions, resolveLanguageModelConfig } from './model-config'

function toolPolicyMeta(
  tools: ToolSet | undefined,
  toolName: string
): { kind?: ToolPolicyKind; fingerprintFields?: string[] } {
  const tool = tools?.[toolName] as
    { metadata?: { tanzo?: { kind?: unknown; fingerprintFields?: unknown } } } | undefined
  const tanzo = tool?.metadata?.tanzo
  const rawKind = tanzo?.kind
  const kind =
    rawKind === 'read' || rawKind === 'search' || rawKind === 'edit' || rawKind === 'exec'
      ? rawKind
      : undefined
  const fingerprintFields = Array.isArray(tanzo?.fingerprintFields)
    ? (tanzo.fingerprintFields as unknown[]).filter((f): f is string => typeof f === 'string')
    : undefined
  return { ...(kind ? { kind } : {}), ...(fingerprintFields ? { fingerprintFields } : {}) }
}

export interface AgentCallInput {
  def: AgentDefinition
  chatId: string
  mode: PermissionMode
  providerService: ProviderService
  tools: ToolSet
  decide: PolicyEngine['decide']
  shouldStop?: () => boolean
  telemetry?: TelemetryOptions
  toolChoice?: ToolChoice<ToolSet>
}

export interface AgentCall {
  model: ReturnType<ProviderService['resolveLanguageModel']>
  tools: ToolSet
  /** Deterministic tool serialization order — the provider cache prefix
   *  includes the tools block, so ordering must be stable across steps. */
  toolOrder: readonly string[]
  runtimeContext: { chatId: string; mode: PermissionMode }
  toolApproval: (opts: {
    tools?: ToolSet
    toolCall: { toolName: string; input: unknown }
    messages: ModelMessage[]
    runtimeContext: unknown
  }) => ReturnType<PolicyEngine['decide']>
  stopWhen: StopCondition<ToolSet>[]
  callSettings: Record<string, unknown>
  providerOptions?: ProviderOptions
  telemetry?: TelemetryOptions
  toolChoice?: ToolChoice<ToolSet>
}

export function buildAgentCall(input: AgentCallInput): AgentCall {
  const modelConfig = resolveLanguageModelConfig(input.providerService, input.def.modelRef)
  // v2: compaction happens inline in prepareStep; no compaction stop condition.
  const stopWhen: StopCondition<ToolSet>[] = []
  if (input.def.maxSteps !== undefined) stopWhen.push(isStepCount(input.def.maxSteps))
  if (input.shouldStop) {
    const shouldStop = input.shouldStop
    stopWhen.push(() => shouldStop())
  }
  return {
    model: modelConfig.model,
    tools: input.tools,
    toolOrder: Object.keys(input.tools).sort(),
    runtimeContext: { chatId: input.chatId, mode: input.mode },
    toolApproval: (opts) => {
      const meta = toolPolicyMeta(opts.tools, opts.toolCall.toolName)
      return input.decide({
        toolCall: {
          toolName: opts.toolCall.toolName,
          input: opts.toolCall.input,
          ...meta
        },
        messages: opts.messages,
        runtimeContext: opts.runtimeContext
      })
    },
    stopWhen,
    callSettings: modelConfig.callSettings as Record<string, unknown>,
    ...(hasProviderOptions(modelConfig.providerOptions)
      ? { providerOptions: modelConfig.providerOptions }
      : {}),
    ...(input.telemetry ? { telemetry: input.telemetry } : {}),
    ...(input.toolChoice ? { toolChoice: input.toolChoice } : {})
  }
}
