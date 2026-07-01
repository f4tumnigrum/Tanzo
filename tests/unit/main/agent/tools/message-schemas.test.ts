import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { validationDataSchemas, validationTools } from '@main/agent/tools/message-schemas'
import { tasksOutputSchema } from '@main/agent/tools/tool-schemas'

function inputSchema(name: keyof typeof validationTools) {
  return (validationTools[name] as unknown as { inputSchema: { parse(value: unknown): unknown } })
    .inputSchema
}

function outputSchema(name: keyof typeof validationTools) {
  return (validationTools[name] as unknown as { outputSchema: { parse(value: unknown): unknown } })
    .outputSchema
}

describe('main/agent/tools/message-schemas', () => {
  it('validates representative tool input and output schemas', () => {
    expect(inputSchema('fileRead').parse({ path: 'a.ts', startLine: 1 })).toEqual({
      path: 'a.ts',
      startLine: 1
    })
    expect(() => inputSchema('fileRead').parse({ path: 'a.ts', startLine: 0 })).toThrow()
    expect(() => inputSchema('fileRead').parse({ path: 'a.ts', offset: 1 })).toThrow()
    expect(() => inputSchema('fileRead').parse({ path: 'a.ts', lineCount: 2001 })).toThrow()
    expect(
      inputSchema('grep').parse({ pattern: 'todo', includeIgnored: true, includeGlob: '*.ts' })
    ).toEqual({ pattern: 'todo', includeIgnored: true, includeGlob: '*.ts' })
    expect(inputSchema('glob').parse({ pattern: '**/*.ts', limit: 250 })).toEqual({
      pattern: '**/*.ts',
      limit: 250
    })
    expect(() => inputSchema('glob').parse({ pattern: '**/*.ts', limit: 501 })).toThrow()
    expect(outputSchema('grep').parse({ mode: 'count', count: 2 })).toEqual({
      mode: 'count',
      count: 2
    })
    expect(
      inputSchema('askQuestion').parse({
        questions: [
          {
            id: 'scope',
            title: 'Scope',
            prompt: 'Which scope should this apply to?',
            options: [
              { value: 'current', label: 'Current chat' },
              { value: 'all', label: 'All chats' }
            ]
          }
        ]
      })
    ).toMatchObject({ questions: [{ id: 'scope', type: 'single_select' }] })
    expect(() =>
      inputSchema('askQuestion').parse({
        questions: [
          {
            id: 'bad-id',
            title: 'Bad',
            prompt: 'Bad?',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' }
            ]
          }
        ]
      })
    ).toThrow()
    expect(() =>
      inputSchema('askQuestion').parse({
        questions: [{ id: 'scope', title: 'Scope', prompt: 'Which scope?' }]
      })
    ).toThrow()
    expect(() =>
      inputSchema('askQuestion').parse({
        questions: [
          {
            id: 'rank',
            title: 'Rank',
            prompt: 'Rank these.',
            type: 'rank_priorities',
            allowCustom: true,
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' }
            ]
          }
        ]
      })
    ).toThrow()
    expect(inputSchema('shellStart').parse({ command: 'npm run dev', yieldTimeMs: 1000 })).toEqual({
      command: 'npm run dev',
      yieldTimeMs: 1000
    })
    expect(
      outputSchema('shellPoll').parse({
        sessionId: 'session-1',
        chatId: 'chat-1',
        command: 'npm run dev',
        cwd: '/workspace',
        status: 'running',
        stdout: 'ready',
        stderr: '',
        exitCode: null,
        startedAt: 1,
        updatedAt: 2,
        truncated: false
      })
    ).toMatchObject({ sessionId: 'session-1', status: 'running' })
    expect(inputSchema('browserOpen').parse({ url: 'https://example.com/' })).toEqual({
      url: 'https://example.com/'
    })
    expect(() => inputSchema('browserOpen').parse({})).toThrow()
    expect(
      outputSchema('browserOpen').parse({ url: 'https://example.com/', opened: true })
    ).toEqual({ url: 'https://example.com/', opened: true })
    expect(
      outputSchema('skill').parse({
        instructions: 'body',
        skillDir: '/skill',
        args: null,
        allowedTools: null
      })
    ).toMatchObject({ instructions: 'body' })
  })

  it('converts tasks output schema to JSON Schema', () => {
    expect(() => z.toJSONSchema(tasksOutputSchema)).not.toThrow()
  })

  it('validates every data part schema used by Tanzo UI messages', () => {
    expect(
      validationDataSchemas.plan.parse({ steps: [{ title: 'One', status: 'active' }] })
    ).toEqual({
      steps: [{ title: 'One', status: 'active' }]
    })
    expect(
      validationDataSchemas.context.parse({
        compactionTriggerTokens: 2,
        compactionTriggered: false,
        source: 'unavailable',
        cacheKind: 'auto',
        serverCompaction: false
      })
    ).toMatchObject({ compactionTriggerTokens: 2, compactionTriggered: false })
    expect(
      validationDataSchemas.telemetry.parse({
        event: 'retry-exhausted',
        runId: 'run-1',
        scope: 'chat',
        sequence: 1,
        timestamp: 1000,
        chatId: 'chat-1',
        provider: 'openai',
        modelId: 'gpt',
        retry: {
          attempt: 3,
          reason: 'maxRetriesExceeded',
          attempts: 3,
          lastMessage: 'Rate limited',
          retryable: true
        },
        error: {
          kind: 'retry',
          message: 'Failed after 3 attempts',
          statusCode: 429,
          retryable: true,
          reason: 'maxRetriesExceeded',
          attempts: 3
        }
      })
    ).toMatchObject({ event: 'retry-exhausted', provider: 'openai' })
    expect(() => validationDataSchemas.compaction.parse({ stage: 'unknown' })).toThrow()
  })
})
