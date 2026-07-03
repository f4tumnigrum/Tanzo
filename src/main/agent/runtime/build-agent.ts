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
  compactionTriggerTokens?: number
  shouldStop?: () => boolean
  telemetry?: TelemetryOptions
  toolChoice?: ToolChoice<ToolSet>
}

export interface AgentCall {
  model: ReturnType<ProviderService['resolveLanguageModel']>
  tools: ToolSet
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

function overCompactionTrigger(trigger: number | undefined): StopCondition<ToolSet> {
  return ({ steps }) => {
    if (trigger === undefined) return false
    const last = steps[steps.length - 1]
    return (last?.usage?.inputTokens ?? 0) > trigger
  }
}

export function buildAgentCall(input: AgentCallInput): AgentCall {
  const modelConfig = resolveLanguageModelConfig(input.providerService, input.def.modelRef)
  const stopWhen: StopCondition<ToolSet>[] = [overCompactionTrigger(input.compactionTriggerTokens)]
  if (input.def.maxSteps !== undefined) stopWhen.unshift(isStepCount(input.def.maxSteps))
  if (input.shouldStop) {
    const shouldStop = input.shouldStop
    stopWhen.push(() => shouldStop())
  }
  return {
    model: modelConfig.model,
    tools: input.tools,
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
