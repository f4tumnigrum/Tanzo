import type { SqlDatabase } from '../../database/types'
import type {
  PromptCacheDiagnosticFinish,
  PromptCacheDiagnosticRecord,
  PromptDiagnosticPrevious
} from '../diagnostics/prompt-cache'

export interface PromptDiagnosticRepo {
  getLatest(chatId: string): PromptDiagnosticPrevious | undefined
  record(record: PromptCacheDiagnosticRecord): void
  finish(finish: PromptCacheDiagnosticFinish): void
  markRunOutcome(
    conversationId: string,
    externalRunId: string,
    status: 'finished' | 'failed',
    errorJson?: string
  ): void
  sweepInterruptedRuns(): number
  pruneRunsBefore(cutoff: number): void
}

export function createPromptDiagnosticRepo(db: SqlDatabase): PromptDiagnosticRepo {
  const selectLatestPromptDiagnostic = db.prepare(
    `SELECT prompt_diagnostics.id, prompt_diagnostics.segments_json
     FROM prompt_diagnostics
     INNER JOIN run_steps ON run_steps.id = prompt_diagnostics.run_step_id
     INNER JOIN runs ON runs.id = run_steps.run_id
     WHERE runs.conversation_id = ?
     ORDER BY prompt_diagnostics.created_at DESC, run_steps.step_number DESC
     LIMIT 1`
  )
  const upsertRun = db.prepare(`
    INSERT INTO runs (
      id, conversation_id, external_run_id, model_ref, provider, status, started_at
    ) VALUES (
      @id, @conversation_id, @external_run_id, @model_ref, @provider, 'running', @started_at
    )
    ON CONFLICT(conversation_id, external_run_id) DO UPDATE SET
      model_ref = excluded.model_ref,
      provider = excluded.provider
  `)
  const upsertRunStep = db.prepare(`
    INSERT INTO run_steps (id, run_id, step_number, created_at)
    VALUES (@id, @run_id, @step_number, @created_at)
    ON CONFLICT(run_id, step_number) DO UPDATE SET
      created_at = excluded.created_at
  `)
  const insertPromptDiagnostic = db.prepare(`
    INSERT INTO prompt_diagnostics (
      id,
      run_step_id,
      created_at,
      prompt_cache_key,
      prompt_cache_retention,
      system_hash,
      system_chars,
      messages_hash,
      messages_chars,
      tools_hash,
      tools_json,
      provider_options_hash,
      provider_options_json,
      prompt_hash,
      prompt_chars,
      segments_json,
      previous_id,
      diff_json
    ) VALUES (
      @id,
      @run_step_id,
      @created_at,
      @prompt_cache_key,
      @prompt_cache_retention,
      @system_hash,
      @system_chars,
      @messages_hash,
      @messages_chars,
      @tools_hash,
      @tools_json,
      @provider_options_hash,
      @provider_options_json,
      @prompt_hash,
      @prompt_chars,
      @segments_json,
      @previous_id,
      @diff_json
    )
    ON CONFLICT(id) DO UPDATE SET
      run_step_id = excluded.run_step_id,
      created_at = excluded.created_at,
      prompt_cache_key = excluded.prompt_cache_key,
      prompt_cache_retention = excluded.prompt_cache_retention,
      system_hash = excluded.system_hash,
      system_chars = excluded.system_chars,
      messages_hash = excluded.messages_hash,
      messages_chars = excluded.messages_chars,
      tools_hash = excluded.tools_hash,
      tools_json = excluded.tools_json,
      provider_options_hash = excluded.provider_options_hash,
      provider_options_json = excluded.provider_options_json,
      prompt_hash = excluded.prompt_hash,
      prompt_chars = excluded.prompt_chars,
      segments_json = excluded.segments_json,
      previous_id = excluded.previous_id,
      diff_json = excluded.diff_json
  `)
  const updatePromptDiagnosticFinish = db.prepare(`
    UPDATE run_steps
    SET usage_json = @usage_json,
        finish_reason = @finish_reason,
        provider_metadata_json = @provider_metadata_json,
        input_tokens = @input_tokens,
        output_tokens = @output_tokens,
        total_tokens = @total_tokens,
        cache_read_tokens = @cache_read_tokens,
        cache_write_tokens = @cache_write_tokens
    WHERE run_id = @run_id
      AND step_number = @step_number
  `)
  const finishRun = db.prepare(`
    UPDATE runs
    SET input_tokens = (SELECT COALESCE(SUM(input_tokens), 0) FROM run_steps WHERE run_id = @run_id),
        output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM run_steps WHERE run_id = @run_id),
        total_tokens = (SELECT COALESCE(SUM(total_tokens), 0) FROM run_steps WHERE run_id = @run_id)
    WHERE id = @run_id
  `)
  const markRunOutcomeRow = db.prepare(`
    UPDATE runs
    SET status = @status,
        finished_at = @finished_at,
        error_json = @error_json
    WHERE id = @run_id
  `)
  const countRunningRuns = db.prepare(`SELECT COUNT(*) AS c FROM runs WHERE status = 'running'`)
  const sweepRunningRuns = db.prepare(`
    UPDATE runs
    SET status = 'failed',
        finished_at = @finished_at,
        error_json = '{"kind":"interrupted"}'
    WHERE status = 'running'
  `)
  const pruneRuns = db.prepare('DELETE FROM runs WHERE started_at < ?')

  function runPk(conversationId: string, runId: string): string {
    return `${conversationId}:${runId}`
  }

  function stepPk(runId: string, stepNumber: number): string {
    return `${runId}:${stepNumber}`
  }

  function requireUpdated(changes: number, message: string): void {
    if (changes === 0) throw new Error(message)
  }

  return {
    getLatest(chatId) {
      const row = selectLatestPromptDiagnostic.get([chatId]) as
        { id: string; segments_json: string } | undefined
      return row ? { id: row.id, segmentsJson: row.segments_json } : undefined
    },
    record(record) {
      db.transaction(() => {
        const runId = runPk(record.conversationId, record.runId)
        upsertRun.run({
          id: runId,
          conversation_id: record.conversationId,
          external_run_id: record.runId,
          model_ref: record.modelRef,
          provider: record.provider,
          started_at: record.createdAt
        })
        const persistedRunId = runPk(record.conversationId, record.runId)
        const runStepId = stepPk(persistedRunId, record.stepNumber)
        upsertRunStep.run({
          id: runStepId,
          run_id: persistedRunId,
          step_number: record.stepNumber,
          created_at: record.createdAt
        })
        insertPromptDiagnostic.run({
          id: record.id,
          run_step_id: runStepId,
          created_at: record.createdAt,
          prompt_cache_key: record.promptCacheKey ?? null,
          prompt_cache_retention: record.promptCacheRetention ?? null,
          system_hash: record.systemHash,
          system_chars: record.systemChars,
          messages_hash: record.messagesHash,
          messages_chars: record.messagesChars,
          tools_hash: record.toolsHash,
          tools_json: record.toolsJson,
          provider_options_hash: record.providerOptionsHash,
          provider_options_json: record.providerOptionsJson,
          prompt_hash: record.promptHash,
          prompt_chars: record.promptChars,
          segments_json: record.segmentsJson,
          previous_id: record.previousId ?? null,
          diff_json: record.diffJson ?? null
        })
      })
    },
    finish(finish) {
      db.transaction(() => {
        const runId = runPk(finish.conversationId, finish.runId)
        requireUpdated(
          updatePromptDiagnosticFinish.run({
            run_id: runId,
            step_number: finish.stepNumber,
            usage_json: finish.usageJson ?? null,
            finish_reason: finish.finishReason ?? null,
            provider_metadata_json: finish.providerMetadataJson ?? null,
            input_tokens: finish.inputTokens ?? null,
            output_tokens: finish.outputTokens ?? null,
            total_tokens: finish.totalTokens ?? null,
            cache_read_tokens: finish.cacheReadTokens ?? null,
            cache_write_tokens: finish.cacheWriteTokens ?? null
          }).changes,
          `Run step ${runId}:${finish.stepNumber} was not found.`
        )
        requireUpdated(finishRun.run({ run_id: runId }).changes, `Run ${runId} was not found.`)
      })
    },
    markRunOutcome(conversationId, externalRunId, status, errorJson) {
      requireUpdated(
        markRunOutcomeRow.run({
          run_id: runPk(conversationId, externalRunId),
          status,
          finished_at: Date.now(),
          error_json: errorJson ?? null
        }).changes,
        `Run ${conversationId}:${externalRunId} was not found.`
      )
    },
    sweepInterruptedRuns() {
      const running = (countRunningRuns.get() as { c: number }).c
      if (running > 0) sweepRunningRuns.run({ finished_at: Date.now() })
      return running
    },
    pruneRunsBefore(cutoff) {
      pruneRuns.run([cutoff])
    }
  }
}
