export interface ActivityRange {
  from: number

  to: number
}

export interface ActivityRunPage {
  limit: number
  offset: number
}

export interface ActivityKpis {
  runCount: number
  finishedCount: number
  failedCount: number
  failureRate: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number

  cacheHitRatio: number
  ttftP50Ms: number | null
  ttftP95Ms: number | null
}

export interface ActivityModelBreakdownRow {
  provider: string
  modelRef: string
  runCount: number
  failedCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ActivityToolProfileRow {
  toolName: string
  callCount: number
  successCount: number
  successRate: number
  avgDurationMs: number | null
  p50DurationMs: number | null
  p95DurationMs: number | null
}

export interface ActivitySummary {
  kpis: ActivityKpis
  models: ActivityModelBreakdownRow[]
  tools: ActivityToolProfileRow[]
}

export type ActivityBucketUnit = 'hour' | 'day' | 'week' | 'month'

export interface ActivityTrendPoint {
  bucketStart: number
  inputTokens: number
  outputTokens: number
  runCount: number
  failedCount: number
}

export interface ActivityTrend {
  unit: ActivityBucketUnit
  points: ActivityTrendPoint[]
}

export interface ActivityErrorBucket {
  kind: string
  count: number
}

export interface ActivityFinishReasonBucket {
  reason: string
  count: number
}

export interface ActivityProviderReliabilityRow {
  provider: string
  callCount: number
  retriedCallCount: number
  errorKinds: ActivityErrorBucket[]
}

export interface ActivityReliability {
  toolErrorKinds: ActivityErrorBucket[]
  finishReasons: ActivityFinishReasonBucket[]
  failedToolCalls: number
  failedRuns: number
  abortedRuns: number
  runErrorKinds: ActivityErrorBucket[]
  providerReliability: ActivityProviderReliabilityRow[]
}

export interface ActivityRunSummary {
  id: string
  conversationId: string
  conversationTitle: string
  externalRunId: string
  provider: string
  modelRef: string
  status: 'running' | 'finished' | 'failed'
  startedAt: number
  finishedAt: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface ActivityRunList {
  runs: ActivityRunSummary[]
  total: number
}

export interface ActivityConversationSummary {
  id: string
  title: string
  latestRunId: string
  status: 'running' | 'finished' | 'failed'
  runCount: number
  stepCount: number
  failedCount: number
  startedAt: number
  lastRunAt: number
  provider: string
  modelRef: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ActivityConversationList {
  conversations: ActivityConversationSummary[]
  total: number
}

export interface ActivityRunStep {
  stepNumber: number
  finishReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

export interface ActivityRunToolCall {
  toolName: string
  success: boolean
  durationMs: number | null
  errorKind: string | null
  errorMessage: string | null
  createdAt: number
}

export interface ActivityRunDetail {
  run: ActivityRunSummary | null
  steps: ActivityRunStep[]
  tools: ActivityRunToolCall[]
}

export const ACTIVITY_CHANNELS = {
  summary: 'activity:summary',
  trend: 'activity:trend',
  reliability: 'activity:reliability',
  conversations: 'activity:conversations',
  runs: 'activity:runs',
  runDetail: 'activity:run-detail'
} as const

export type ActivityChannel = (typeof ACTIVITY_CHANNELS)[keyof typeof ACTIVITY_CHANNELS]

export interface ActivityApi {
  summary(range: ActivityRange): Promise<ActivitySummary>
  trend(range: ActivityRange): Promise<ActivityTrend>
  reliability(range: ActivityRange): Promise<ActivityReliability>
  conversations(range: ActivityRange, page: ActivityRunPage): Promise<ActivityConversationList>
  runs(range: ActivityRange, page: ActivityRunPage): Promise<ActivityRunList>
  runDetail(runId: string): Promise<ActivityRunDetail>
}
