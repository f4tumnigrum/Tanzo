import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { SqlDatabase } from '@main/database/types'
import { runMigrations } from '@main/database/migrations'
import { tanzoMigrations } from '@main/database/schema'
import { createActivityRepo } from '@main/agent/repositories/activity-repo'

function createRealDb(): SqlDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  return {
    raw,
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const stmt = raw.prepare(sql)

      const bind = (params: unknown): unknown[] =>
        params === undefined ? [] : Array.isArray(params) ? params : [params]
      return {
        run: (params) => {
          stmt.run(...(bind(params) as never[]))
        },
        get: (params) => stmt.get(...(bind(params) as never[])),
        all: (params) => stmt.all(...(bind(params) as never[]))
      }
    },
    transaction: (fn) => fn(),
    pragma: () => {},
    close: () => raw.close()
  }
}

function seed(db: SqlDatabase): void {
  db.exec(`
    INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
      VALUES ('ws', 'ws', '/tmp/ws', 0, 0);
    INSERT INTO conversations (id, workspace_id, title, created_at, updated_at)
      VALUES ('c1', 'ws', 'First chat', 0, 0), ('c2', 'ws', 'Second chat', 0, 0);

    INSERT INTO runs (id, conversation_id, external_run_id, model_ref, provider, status,
      started_at, finished_at, input_tokens, output_tokens, total_tokens)
    VALUES
      ('c1:r1', 'c1', 'r1', 'gpt-4', 'openai', 'finished', 1000, 1500, 100, 50, 150),
      ('c1:r2', 'c1', 'r2', 'gpt-4', 'openai', 'failed',   2000, 2200, 80,  0,  80),
      ('c2:r3', 'c2', 'r3', 'claude', 'anthropic', 'finished', 3000, 3500, 200, 120, 320);

    INSERT INTO run_steps (id, run_id, step_number, created_at, input_tokens, cache_read_tokens,
      cache_write_tokens)
    VALUES
      ('c1:r1:1', 'c1:r1', 1, 1000, 400, 300, 50),
      ('c2:r3:1', 'c2:r3', 1, 3000, 200, 0,   100);
  `)

  const insert = db.prepare(`
    INSERT INTO tool_executions (id, run_id, conversation_id, tool_name, success, duration_ms, created_at)
    VALUES (@id, @run_id, @conversation_id, @tool_name, @success, @duration_ms, @created_at)
  `)
  for (let i = 1; i <= 5; i++) {
    insert.run({
      id: `t${i}`,
      run_id: 'c1:r1',
      conversation_id: 'c1',
      tool_name: 'read',
      success: 1,
      duration_ms: i * 10,
      created_at: 1000 + i
    })
  }
  insert.run({
    id: 't6',
    run_id: 'c1:r2',
    conversation_id: 'c1',
    tool_name: 'grep',
    success: 0,
    duration_ms: 5,
    created_at: 2001
  })

  // telemetry_v2 fields: ttft on finished runs, an aborted run, an error kind on the failed run.
  db.exec(`
    UPDATE runs SET ttft_ms = 120, retry_count = 1 WHERE id = 'c1:r1';
    UPDATE runs SET ttft_ms = 400, retry_count = 3, error_kind = 'api' WHERE id = 'c1:r2';
    UPDATE runs SET ttft_ms = 200, aborted = 1 WHERE id = 'c2:r3';
  `)

  const insertModelCall = db.prepare(`
    INSERT INTO model_calls (id, run_id, conversation_id, scope, provider, model_id, step_number,
      attempt, success, duration_ms, error_kind, status_code, input_tokens, output_tokens,
      cache_read_tokens, created_at)
    VALUES (@id, @run_id, @conversation_id, @scope, @provider, @model_id, @step_number, @attempt,
      @success, @duration_ms, @error_kind, @status_code, @input_tokens, @output_tokens,
      @cache_read_tokens, @created_at)
  `)
  const modelCall = (over: Record<string, unknown>): void =>
    insertModelCall.run({
      id: 'm',
      run_id: 'c1:r1',
      conversation_id: 'c1',
      scope: 'chat',
      provider: 'openai',
      model_id: 'gpt-4',
      step_number: 1,
      attempt: 1,
      success: 1,
      duration_ms: 100,
      error_kind: null,
      status_code: null,
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      created_at: 1500,
      ...over
    })
  modelCall({ id: 'm1' })
  modelCall({ id: 'm2', attempt: 2 })
  modelCall({ id: 'm3', success: 0, error_kind: 'api', status_code: 429 })
  modelCall({ id: 'm4', provider: 'anthropic', model_id: 'claude', run_id: 'c2:r3' })
}

const ALL = { from: 0, to: 10_000 }

describe('activity-repo', () => {
  function setup() {
    const db = createRealDb()
    runMigrations(db, [tanzoMigrations])
    seed(db)
    return createActivityRepo(db)
  }

  it('aggregates KPI totals, cache hit ratio, and failure rate', () => {
    const { kpis } = setup().getSummary(ALL)
    expect(kpis.runCount).toBe(3)
    expect(kpis.finishedCount).toBe(2)
    expect(kpis.failedCount).toBe(1)
    expect(kpis.failureRate).toBeCloseTo(1 / 3)
    expect(kpis.totalTokens).toBe(550)
    expect(kpis.cacheReadTokens).toBe(300)
    expect(kpis.cacheWriteTokens).toBe(150)
    expect(kpis.cacheHitRatio).toBeCloseTo(0.5)
  })

  it('groups by provider and model ordered by total tokens', () => {
    const { models } = setup().getSummary(ALL)
    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({ provider: 'anthropic', modelRef: 'claude', totalTokens: 320 })
    expect(models[1]).toMatchObject({
      provider: 'openai',
      modelRef: 'gpt-4',
      runCount: 2,
      failedCount: 1
    })
  })

  it('profiles tools with success rate and p50/p95 over durations', () => {
    const { tools } = setup().getSummary(ALL)
    const read = tools.find((t) => t.toolName === 'read')
    expect(read).toBeDefined()
    expect(read?.callCount).toBe(5)
    expect(read?.successRate).toBe(1)
    expect(read?.p50DurationMs).toBe(30)
    expect(read?.p95DurationMs).toBe(50)
    const grep = tools.find((t) => t.toolName === 'grep')
    expect(grep?.successRate).toBe(0)
  })

  it('reports ttft percentiles in KPIs', () => {
    const { kpis } = setup().getSummary(ALL)
    // ttft values across runs: 120, 200, 400 -> p50 = 200, p95 = 400
    expect(kpis.ttftP50Ms).toBe(200)
    expect(kpis.ttftP95Ms).toBe(400)
  })

  it('reports abort count, run error kinds, and provider reliability', () => {
    const rel = setup().getReliability(ALL)
    expect(rel.abortedRuns).toBe(1)
    expect(rel.runErrorKinds).toEqual([{ kind: 'api', count: 1 }])

    const openai = rel.providerReliability.find((row) => row.provider === 'openai')
    expect(openai).toBeDefined()
    // openai has 3 model calls (m1, m2, m3); m2 is a retry (attempt > 1)
    expect(openai?.callCount).toBe(3)
    expect(openai?.retriedCallCount).toBe(1)
    expect(openai?.errorKinds).toEqual([{ kind: 'api', count: 1 }])

    const anthropic = rel.providerReliability.find((row) => row.provider === 'anthropic')
    expect(anthropic?.callCount).toBe(1)
    expect(anthropic?.retriedCallCount).toBe(0)
  })

  it('lists runs newest-first with pagination and total', () => {
    const repo = setup()
    const first = repo.listRuns(ALL, { limit: 2, offset: 0 })
    expect(first.total).toBe(3)
    expect(first.runs.map((r) => r.id)).toEqual(['c2:r3', 'c1:r2'])
    expect(first.runs[0].conversationTitle).toBe('Second chat')
    const second = repo.listRuns(ALL, { limit: 2, offset: 2 })
    expect(second.runs.map((r) => r.id)).toEqual(['c1:r1'])
  })

  it('lists conversations aggregated across runs', () => {
    const repo = setup()
    const page = repo.listConversations(ALL, { limit: 10, offset: 0 })

    expect(page.total).toBe(2)
    expect(page.conversations.map((conversation) => conversation.id)).toEqual(['c2', 'c1'])
    expect(page.conversations[0]).toMatchObject({
      id: 'c2',
      title: 'Second chat',
      latestRunId: 'c2:r3',
      status: 'finished',
      runCount: 1,
      stepCount: 1,
      failedCount: 0,
      provider: 'anthropic',
      modelRef: 'claude',
      totalTokens: 320
    })
    expect(page.conversations[1]).toMatchObject({
      id: 'c1',
      title: 'First chat',
      latestRunId: 'c1:r2',
      status: 'failed',
      runCount: 2,
      stepCount: 1,
      failedCount: 1,
      provider: 'openai',
      modelRef: 'gpt-4',
      totalTokens: 230
    })
  })

  it('returns run detail with steps and tool calls', () => {
    const detail = setup().getRunDetail('c1:r1')
    expect(detail.run?.id).toBe('c1:r1')
    expect(detail.steps).toHaveLength(1)
    expect(detail.steps[0].cacheReadTokens).toBe(300)
    expect(detail.tools).toHaveLength(5)
    expect(detail.tools.every((t) => t.toolName === 'read')).toBe(true)
  })

  it('filters by time range', () => {
    const { kpis } = setup().getSummary({ from: 0, to: 1500 })
    expect(kpis.runCount).toBe(1)
    expect(kpis.totalTokens).toBe(150)
  })

  it('handles an empty range without dividing by zero', () => {
    const { kpis } = setup().getSummary({ from: 5000, to: 6000 })
    expect(kpis.runCount).toBe(0)
    expect(kpis.failureRate).toBe(0)
    expect(kpis.cacheHitRatio).toBe(0)
  })
})
