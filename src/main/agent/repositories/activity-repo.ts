import type {
  ActivityBucketUnit,
  ActivityConversationList,
  ActivityConversationSummary,
  ActivityErrorBucket,
  ActivityKpis,
  ActivityModelBreakdownRow,
  ActivityRange,
  ActivityReliability,
  ActivityRunDetail,
  ActivityRunList,
  ActivityRunPage,
  ActivityRunStep,
  ActivityRunSummary,
  ActivityRunToolCall,
  ActivitySummary,
  ActivityToolProfileRow,
  ActivityTrend,
  ActivityTrendPoint
} from '@shared/activity'
import type { SqlDatabase } from '../../database/types'

export interface ActivityRepo {
  getSummary(range: ActivityRange): ActivitySummary
  getTrend(range: ActivityRange): ActivityTrend
  getReliability(range: ActivityRange): ActivityReliability
  listConversations(range: ActivityRange, page: ActivityRunPage): ActivityConversationList
  listRuns(range: ActivityRange, page: ActivityRunPage): ActivityRunList
  getRunDetail(runId: string): ActivityRunDetail
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

function boundedCacheHitRatio(cacheReadTokens: number, inputTokens: number): number {
  return Math.min(1, ratio(cacheReadTokens, inputTokens))
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

function bucketUnit(range: ActivityRange): ActivityBucketUnit {
  const span = range.to - range.from
  if (span <= 36 * HOUR_MS) return 'hour'
  if (span <= 35 * DAY_MS) return 'day'
  if (span <= 26 * WEEK_MS) return 'week'
  return 'month'
}

export function createActivityRepo(db: SqlDatabase): ActivityRepo {
  const selectRunTotals = db.prepare(`
    SELECT
      COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'failed'   THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished_count,
      COALESCE(SUM(input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(total_tokens), 0)  AS total_tokens
    FROM runs
    WHERE started_at BETWEEN @from AND @to
  `)
  const selectCacheTotals = db.prepare(`
    SELECT
      COALESCE(SUM(rs.cache_read_tokens), 0)  AS cache_read_tokens,
      COALESCE(SUM(rs.cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(rs.input_tokens), 0)       AS step_input_tokens
    FROM run_steps rs
    INNER JOIN runs r ON r.id = rs.run_id
    WHERE r.started_at BETWEEN @from AND @to
  `)
  const selectModelBreakdown = db.prepare(`
    SELECT
      r.provider AS provider,
      r.model_ref AS model_ref,
      COUNT(*) AS run_count,
      SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      COALESCE(SUM(r.input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(r.total_tokens), 0)  AS total_tokens
    FROM runs r
    WHERE r.started_at BETWEEN @from AND @to
    GROUP BY r.provider, r.model_ref
    ORDER BY total_tokens DESC
  `)
  const selectToolAggregates = db.prepare(`
    SELECT
      tool_name,
      COUNT(*) AS call_count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
      AVG(duration_ms) AS avg_duration_ms
    FROM tool_executions
    WHERE created_at BETWEEN @from AND @to
    GROUP BY tool_name
    ORDER BY call_count DESC
  `)
  const selectToolDurations = db.prepare(`
    SELECT tool_name, duration_ms
    FROM tool_executions
    WHERE created_at BETWEEN @from AND @to AND duration_ms IS NOT NULL
    ORDER BY tool_name, duration_ms
  `)
  const selectTtftDurations = db.prepare(`
    SELECT ttft_ms FROM runs
    WHERE started_at BETWEEN @from AND @to AND ttft_ms IS NOT NULL
    ORDER BY ttft_ms
  `)
  const selectRunCount = db.prepare(`
    SELECT COUNT(*) AS total FROM runs WHERE started_at BETWEEN @from AND @to
  `)
  const selectConversationCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT conversation_id
      FROM runs
      WHERE started_at BETWEEN @from AND @to
      GROUP BY conversation_id
    )
  `)
  const selectConversations = db.prepare(`
    SELECT
      c.id AS conversation_id,
      c.title AS conversation_title,
      COUNT(*) AS run_count,
      SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN r.status = 'running' THEN 1 ELSE 0 END) AS running_count,
      MIN(r.started_at) AS first_started_at,
      MAX(r.started_at) AS last_run_at,
      COALESCE(SUM(r.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(r.total_tokens), 0) AS total_tokens,
      (
        SELECT COUNT(*)
        FROM run_steps rs
        INNER JOIN runs sr ON sr.id = rs.run_id
        WHERE sr.conversation_id = c.id
          AND sr.started_at BETWEEN @from AND @to
      ) AS step_count,
      (
        SELECT lr.id
        FROM runs lr
        WHERE lr.conversation_id = c.id
          AND lr.started_at BETWEEN @from AND @to
        ORDER BY lr.started_at DESC
        LIMIT 1
      ) AS latest_run_id,
      (
        SELECT lr.provider
        FROM runs lr
        WHERE lr.conversation_id = c.id
          AND lr.started_at BETWEEN @from AND @to
        ORDER BY lr.started_at DESC
        LIMIT 1
      ) AS latest_provider,
      (
        SELECT lr.model_ref
        FROM runs lr
        WHERE lr.conversation_id = c.id
          AND lr.started_at BETWEEN @from AND @to
        ORDER BY lr.started_at DESC
        LIMIT 1
      ) AS latest_model_ref
    FROM runs r
    INNER JOIN conversations c ON c.id = r.conversation_id
    WHERE r.started_at BETWEEN @from AND @to
    GROUP BY c.id
    ORDER BY last_run_at DESC
    LIMIT @limit OFFSET @offset
  `)
  const selectRuns = db.prepare(`
    SELECT
      r.id, r.conversation_id, r.external_run_id, r.model_ref, r.provider, r.status,
      r.started_at, r.finished_at, r.input_tokens, r.output_tokens, r.total_tokens,
      c.title AS conversation_title
    FROM runs r
    INNER JOIN conversations c ON c.id = r.conversation_id
    WHERE r.started_at BETWEEN @from AND @to
    ORDER BY r.started_at DESC
    LIMIT @limit OFFSET @offset
  `)
  const selectRunById = db.prepare(`
    SELECT
      r.id, r.conversation_id, r.external_run_id, r.model_ref, r.provider, r.status,
      r.started_at, r.finished_at, r.input_tokens, r.output_tokens, r.total_tokens,
      c.title AS conversation_title
    FROM runs r
    INNER JOIN conversations c ON c.id = r.conversation_id
    WHERE r.id = @run_id
  `)
  const selectRunSteps = db.prepare(`
    SELECT step_number, finish_reason, input_tokens, output_tokens, total_tokens,
      cache_read_tokens, cache_write_tokens
    FROM run_steps
    WHERE run_id = @run_id
    ORDER BY step_number
  `)
  const selectRunTools = db.prepare(`
    SELECT tool_name, success, duration_ms, error_kind, error_message, created_at
    FROM tool_executions
    WHERE run_id = @run_id
    ORDER BY created_at
  `)
  const selectTrendFixed = db.prepare(`
    SELECT
      CAST(started_at / @bucket_ms AS INTEGER) * @bucket_ms AS bucket,
      COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      COALESCE(SUM(input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM runs
    WHERE started_at BETWEEN @from AND @to
    GROUP BY bucket ORDER BY bucket
  `)
  const selectTrendMonth = db.prepare(`
    SELECT
      strftime('%Y-%m', datetime(started_at / 1000, 'unixepoch')) AS bucket,
      COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      COALESCE(SUM(input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM runs
    WHERE started_at BETWEEN @from AND @to
    GROUP BY bucket ORDER BY bucket
  `)
  const selectToolErrorKinds = db.prepare(`
    SELECT COALESCE(error_kind, 'unknown') AS kind, COUNT(*) AS count
    FROM tool_executions
    WHERE created_at BETWEEN @from AND @to AND success = 0
    GROUP BY kind ORDER BY count DESC
  `)
  const selectFailedToolCalls = db.prepare(`
    SELECT COUNT(*) AS count FROM tool_executions
    WHERE created_at BETWEEN @from AND @to AND success = 0
  `)
  const selectFinishReasons = db.prepare(`
    SELECT COALESCE(rs.finish_reason, 'unknown') AS reason, COUNT(*) AS count
    FROM run_steps rs INNER JOIN runs r ON r.id = rs.run_id
    WHERE r.started_at BETWEEN @from AND @to
    GROUP BY reason ORDER BY count DESC
  `)
  const selectFailedRunCount = db.prepare(`
    SELECT COUNT(*) AS count FROM runs
    WHERE started_at BETWEEN @from AND @to AND status = 'failed'
  `)
  const selectAbortedRunCount = db.prepare(`
    SELECT COUNT(*) AS count FROM runs
    WHERE started_at BETWEEN @from AND @to AND aborted = 1
  `)
  const selectRunErrorKinds = db.prepare(`
    SELECT error_kind AS kind, COUNT(*) AS count
    FROM runs
    WHERE started_at BETWEEN @from AND @to AND error_kind IS NOT NULL
    GROUP BY error_kind ORDER BY count DESC
  `)
  const selectProviderCallStats = db.prepare(`
    SELECT
      COALESCE(provider, 'unknown') AS provider,
      COUNT(*) AS call_count,
      SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END) AS retried_call_count
    FROM model_calls
    WHERE created_at BETWEEN @from AND @to
    GROUP BY provider ORDER BY call_count DESC
  `)
  const selectProviderErrorKinds = db.prepare(`
    SELECT
      COALESCE(provider, 'unknown') AS provider,
      COALESCE(error_kind, 'unknown') AS kind,
      COUNT(*) AS count
    FROM model_calls
    WHERE created_at BETWEEN @from AND @to AND success = 0
    GROUP BY provider, error_kind ORDER BY count DESC
  `)

  function mapRun(row: Record<string, unknown>): ActivityRunSummary {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      conversationTitle: typeof row.conversation_title === 'string' ? row.conversation_title : '',
      externalRunId: String(row.external_run_id),
      provider: String(row.provider),
      modelRef: String(row.model_ref),
      status: row.status as ActivityRunSummary['status'],
      startedAt: num(row.started_at),
      finishedAt: numOrNull(row.finished_at),
      inputTokens: numOrNull(row.input_tokens),
      outputTokens: numOrNull(row.output_tokens),
      totalTokens: numOrNull(row.total_tokens)
    }
  }

  function mapConversation(row: Record<string, unknown>): ActivityConversationSummary {
    const runningCount = num(row.running_count)
    const failedCount = num(row.failed_count)
    const status: ActivityConversationSummary['status'] =
      runningCount > 0 ? 'running' : failedCount > 0 ? 'failed' : 'finished'
    return {
      id: String(row.conversation_id),
      title: String(row.conversation_title ?? ''),
      latestRunId: String(row.latest_run_id),
      status,
      runCount: num(row.run_count),
      stepCount: num(row.step_count),
      failedCount,
      startedAt: num(row.first_started_at),
      lastRunAt: num(row.last_run_at),
      provider: String(row.latest_provider ?? ''),
      modelRef: String(row.latest_model_ref ?? ''),
      inputTokens: num(row.input_tokens),
      outputTokens: num(row.output_tokens),
      totalTokens: num(row.total_tokens)
    }
  }

  function bindRange(range: ActivityRange): Record<string, number> {
    return { from: range.from, to: range.to }
  }

  function toolProfile(range: ActivityRange): ActivityToolProfileRow[] {
    const aggregates = selectToolAggregates.all(bindRange(range)) as Array<Record<string, unknown>>
    const durationRows = selectToolDurations.all(bindRange(range)) as Array<{
      tool_name: string
      duration_ms: number
    }>
    const byTool = new Map<string, number[]>()
    for (const row of durationRows) {
      const bucket = byTool.get(row.tool_name)
      if (bucket) bucket.push(row.duration_ms)
      else byTool.set(row.tool_name, [row.duration_ms])
    }
    return aggregates.map((row) => {
      const toolName = String(row.tool_name)
      const callCount = num(row.call_count)
      const successCount = num(row.success_count)
      const sorted = byTool.get(toolName) ?? []
      return {
        toolName,
        callCount,
        successCount,
        successRate: ratio(successCount, callCount),
        avgDurationMs: numOrNull(row.avg_duration_ms),
        p50DurationMs: percentile(sorted, 50),
        p95DurationMs: percentile(sorted, 95)
      }
    })
  }

  function kpis(range: ActivityRange): ActivityKpis {
    const totals = selectRunTotals.get(bindRange(range)) as Record<string, unknown>
    const cache = selectCacheTotals.get(bindRange(range)) as Record<string, unknown>
    const runCount = num(totals.run_count)
    const failedCount = num(totals.failed_count)
    const cacheReadTokens = num(cache.cache_read_tokens)
    const stepInputTokens = num(cache.step_input_tokens)
    const ttfts = (selectTtftDurations.all(bindRange(range)) as Array<{ ttft_ms: number }>).map(
      (row) => row.ttft_ms
    )
    return {
      runCount,
      finishedCount: num(totals.finished_count),
      failedCount,
      failureRate: ratio(failedCount, runCount),
      inputTokens: num(totals.input_tokens),
      outputTokens: num(totals.output_tokens),
      totalTokens: num(totals.total_tokens),
      cacheReadTokens,
      cacheWriteTokens: num(cache.cache_write_tokens),
      cacheHitRatio: boundedCacheHitRatio(cacheReadTokens, stepInputTokens),
      ttftP50Ms: percentile(ttfts, 50),
      ttftP95Ms: percentile(ttfts, 95)
    }
  }

  function trend(range: ActivityRange): ActivityTrend {
    const unit = bucketUnit(range)
    const mapPoint = (row: Record<string, unknown>, bucketStart: number): ActivityTrendPoint => ({
      bucketStart,
      inputTokens: num(row.input_tokens),
      outputTokens: num(row.output_tokens),
      runCount: num(row.run_count),
      failedCount: num(row.failed_count)
    })
    if (unit === 'month') {
      const rows = selectTrendMonth.all(bindRange(range)) as Array<Record<string, unknown>>
      return {
        unit,
        points: rows.map((row) => mapPoint(row, Date.parse(`${String(row.bucket)}-01T00:00:00Z`)))
      }
    }
    const bucketMs = unit === 'hour' ? HOUR_MS : unit === 'day' ? DAY_MS : WEEK_MS
    const rows = selectTrendFixed.all({
      from: range.from,
      to: range.to,
      bucket_ms: bucketMs
    }) as Array<Record<string, unknown>>
    return { unit, points: rows.map((row) => mapPoint(row, num(row.bucket))) }
  }

  function reliability(range: ActivityRange): ActivityReliability {
    const toolErrorKinds = (
      selectToolErrorKinds.all(bindRange(range)) as Array<Record<string, unknown>>
    ).map((row) => ({ kind: String(row.kind), count: num(row.count) }))
    const finishReasons = (
      selectFinishReasons.all(bindRange(range)) as Array<Record<string, unknown>>
    ).map((row) => ({ reason: String(row.reason), count: num(row.count) }))
    const failedToolCalls = num(
      (selectFailedToolCalls.get(bindRange(range)) as Record<string, unknown>).count
    )
    const failedRuns = num(
      (selectFailedRunCount.get(bindRange(range)) as Record<string, unknown>).count
    )
    const abortedRuns = num(
      (selectAbortedRunCount.get(bindRange(range)) as Record<string, unknown>).count
    )
    const runErrorKinds = (
      selectRunErrorKinds.all(bindRange(range)) as Array<Record<string, unknown>>
    ).map((row) => ({ kind: String(row.kind), count: num(row.count) }))
    const providerErrorsByProvider = new Map<string, ActivityErrorBucket[]>()
    for (const row of selectProviderErrorKinds.all(bindRange(range)) as Array<
      Record<string, unknown>
    >) {
      const provider = String(row.provider)
      const bucket = providerErrorsByProvider.get(provider) ?? []
      bucket.push({ kind: String(row.kind), count: num(row.count) })
      providerErrorsByProvider.set(provider, bucket)
    }
    const providerReliability = (
      selectProviderCallStats.all(bindRange(range)) as Array<Record<string, unknown>>
    ).map((row) => {
      const provider = String(row.provider)
      return {
        provider,
        callCount: num(row.call_count),
        retriedCallCount: num(row.retried_call_count),
        errorKinds: providerErrorsByProvider.get(provider) ?? []
      }
    })
    return {
      toolErrorKinds,
      finishReasons,
      failedToolCalls,
      failedRuns,
      abortedRuns,
      runErrorKinds,
      providerReliability
    }
  }

  return {
    getSummary(range) {
      const models = (
        selectModelBreakdown.all(bindRange(range)) as Array<Record<string, unknown>>
      ).map((row): ActivityModelBreakdownRow => ({
        provider: String(row.provider),
        modelRef: String(row.model_ref),
        runCount: num(row.run_count),
        failedCount: num(row.failed_count),
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens),
        totalTokens: num(row.total_tokens)
      }))
      return { kpis: kpis(range), models, tools: toolProfile(range) }
    },
    getTrend(range) {
      return trend(range)
    },
    getReliability(range) {
      return reliability(range)
    },
    listConversations(range, page) {
      const total = num(
        (selectConversationCount.get(bindRange(range)) as Record<string, unknown>).total
      )
      const rows = selectConversations.all({
        from: range.from,
        to: range.to,
        limit: page.limit,
        offset: page.offset
      }) as Array<Record<string, unknown>>
      return { conversations: rows.map(mapConversation), total }
    },
    listRuns(range, page) {
      const total = num((selectRunCount.get(bindRange(range)) as Record<string, unknown>).total)
      const rows = selectRuns.all({
        from: range.from,
        to: range.to,
        limit: page.limit,
        offset: page.offset
      }) as Array<Record<string, unknown>>
      return { runs: rows.map(mapRun), total }
    },
    getRunDetail(runId) {
      const runRow = selectRunById.get({ run_id: runId }) as Record<string, unknown> | undefined
      const steps = (selectRunSteps.all({ run_id: runId }) as Array<Record<string, unknown>>).map(
        (row): ActivityRunStep => ({
          stepNumber: num(row.step_number),
          finishReason: typeof row.finish_reason === 'string' ? row.finish_reason : null,
          inputTokens: numOrNull(row.input_tokens),
          outputTokens: numOrNull(row.output_tokens),
          totalTokens: numOrNull(row.total_tokens),
          cacheReadTokens: numOrNull(row.cache_read_tokens),
          cacheWriteTokens: numOrNull(row.cache_write_tokens)
        })
      )
      const tools = (selectRunTools.all({ run_id: runId }) as Array<Record<string, unknown>>).map(
        (row): ActivityRunToolCall => ({
          toolName: String(row.tool_name),
          success: num(row.success) === 1,
          durationMs: numOrNull(row.duration_ms),
          errorKind: typeof row.error_kind === 'string' ? row.error_kind : null,
          errorMessage: typeof row.error_message === 'string' ? row.error_message : null,
          createdAt: num(row.created_at)
        })
      )
      return { run: runRow ? mapRun(runRow) : null, steps, tools }
    }
  }
}
