import type { SqlDatabase } from '../../database/types'

export interface ModelCallRecord {
  id: string
  runId: string
  conversationId: string
  scope: string
  provider?: string
  modelId?: string
  stepNumber?: number
  attempt: number
  success: boolean
  durationMs?: number
  errorKind?: string
  statusCode?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  createdAt: number
}

export interface ModelCallRepo {
  record(record: ModelCallRecord): void
  pruneBefore(cutoff: number): void
}

export function createModelCallRepo(db: SqlDatabase): ModelCallRepo {
  const pruneModelCalls = db.prepare('DELETE FROM model_calls WHERE created_at < ?')
  const insertModelCall = db.prepare(`
    INSERT INTO model_calls (
      id,
      run_id,
      conversation_id,
      scope,
      provider,
      model_id,
      step_number,
      attempt,
      success,
      duration_ms,
      error_kind,
      status_code,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      created_at
    ) VALUES (
      @id,
      @run_id,
      @conversation_id,
      @scope,
      @provider,
      @model_id,
      @step_number,
      @attempt,
      @success,
      @duration_ms,
      @error_kind,
      @status_code,
      @input_tokens,
      @output_tokens,
      @cache_read_tokens,
      @created_at
    )
    ON CONFLICT(id) DO NOTHING
  `)

  return {
    record(record) {
      insertModelCall.run({
        id: record.id,
        run_id: record.runId,
        conversation_id: record.conversationId,
        scope: record.scope,
        provider: record.provider ?? null,
        model_id: record.modelId ?? null,
        step_number: record.stepNumber ?? null,
        attempt: record.attempt,
        success: record.success ? 1 : 0,
        duration_ms: record.durationMs ?? null,
        error_kind: record.errorKind ?? null,
        status_code: record.statusCode ?? null,
        input_tokens: record.inputTokens ?? null,
        output_tokens: record.outputTokens ?? null,
        cache_read_tokens: record.cacheReadTokens ?? null,
        created_at: record.createdAt
      })
    },
    pruneBefore(cutoff) {
      pruneModelCalls.run([cutoff])
    }
  }
}
