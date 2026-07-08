import type { TanzoDataParts, TanzoUsageMetadata } from '@shared/agent-message'

export type AgentTelemetryScope = TanzoDataParts['telemetry']['scope']
export type AgentTelemetryEvent = TanzoDataParts['telemetry']
export type AgentTelemetryEventName = AgentTelemetryEvent['event']
export type AgentTelemetryError = NonNullable<AgentTelemetryEvent['error']>
export type AgentTelemetryRetry = NonNullable<AgentTelemetryEvent['retry']>

export interface AgentTelemetryRawRecord {
  runId: string
  scope: AgentTelemetryScope
  chatId?: string
  timestamp: number
  kind: string
  raw: unknown
}

export interface AgentTelemetrySinkRecord {
  data?: AgentTelemetryEvent
  raw?: AgentTelemetryRawRecord
}

export interface AgentTelemetrySink {
  emit(record: AgentTelemetrySinkRecord): void | Promise<void>
  wantsRaw?: boolean
}

export type AgentTelemetryEmitInput = Omit<
  AgentTelemetryEvent,
  'runId' | 'scope' | 'sequence' | 'timestamp' | 'chatId'
> & {
  timestamp?: number
  chatId?: string
  scope?: AgentTelemetryScope
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

export function normalizeTelemetryUsage(usage: unknown): TanzoUsageMetadata | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const value = usage as UsageLike
  const normalized: TanzoUsageMetadata = {
    ...(typeof value.inputTokens === 'number' ? { inputTokens: value.inputTokens } : {}),
    ...(typeof value.outputTokens === 'number' ? { outputTokens: value.outputTokens } : {}),
    ...(typeof value.totalTokens === 'number' ? { totalTokens: value.totalTokens } : {}),
    ...(typeof value.outputTokenDetails?.reasoningTokens === 'number'
      ? { reasoningTokens: value.outputTokenDetails.reasoningTokens }
      : typeof value.reasoningTokens === 'number'
        ? { reasoningTokens: value.reasoningTokens }
        : {}),
    ...(typeof value.inputTokenDetails?.cacheReadTokens === 'number'
      ? { cacheReadTokens: value.inputTokenDetails.cacheReadTokens }
      : typeof value.cachedInputTokens === 'number'
        ? { cacheReadTokens: value.cachedInputTokens }
        : {}),
    ...(typeof value.inputTokenDetails?.cacheWriteTokens === 'number'
      ? { cacheWriteTokens: value.inputTokenDetails.cacheWriteTokens }
      : {})
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function recordField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}
