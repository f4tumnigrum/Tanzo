import type { Tool } from 'ai'
import { z } from 'zod/v4'
import type { TanzoDataParts, TanzoTools } from '@shared/agent-message'
import {
  fileEditInputSchema,
  fileEditOutputSchema,
  fileReadInputSchema,
  fileReadOutputSchema,
  fileWriteInputSchema,
  fileWriteOutputSchema,
  globInputSchema,
  globOutputSchema,
  grepInputSchema,
  grepOutputSchema,
  multiEditInputSchema,
  multiEditOutputSchema,
  shellInputSchema,
  shellListInputSchema,
  shellListOutputSchema,
  shellOutputSchema,
  shellPollInputSchema,
  shellSessionOutputOrErrorSchema,
  shellStartInputSchema,
  shellStopInputSchema,
  shellStopOutputSchema,
  shellWriteInputSchema,
  skillInputSchema,
  skillOutputSchema,
  spawnInputSchema,
  spawnOutputSchema,
  awaitInputSchema,
  awaitOutputSchema,
  tasksInputSchema,
  tasksOutputSchema,
  steerInputSchema,
  steerOutputSchema,
  cancelTaskInputSchema,
  cancelTaskOutputSchema,
  reportInputSchema,
  reportOutputSchema,
  todoInputSchema,
  todoOutputSchema,
  exitPlanModeInputSchema,
  exitPlanModeOutputSchema,
  updateGoalInputSchema,
  updateGoalOutputSchema,
  askQuestionInputSchema,
  askQuestionOutputSchema,
  browserOpenInputSchema,
  browserOpenOutputSchema
} from './tool-schemas'

const providerToolPayloadSchema = z.unknown()

type ValidationTools = {
  [K in keyof TanzoTools]: Tool<TanzoTools[K]['input'], TanzoTools[K]['output']>
}

function asTool<K extends keyof TanzoTools>(
  inputSchema: z.ZodTypeAny,
  outputSchema: z.ZodTypeAny
): Tool<TanzoTools[K]['input'], TanzoTools[K]['output']> {
  return { inputSchema, outputSchema } as unknown as Tool<
    TanzoTools[K]['input'],
    TanzoTools[K]['output']
  >
}

export const validationTools = {
  fileRead: asTool<'fileRead'>(fileReadInputSchema, fileReadOutputSchema),
  fileEdit: asTool<'fileEdit'>(fileEditInputSchema, fileEditOutputSchema),
  multiEdit: asTool<'multiEdit'>(multiEditInputSchema, multiEditOutputSchema),
  fileWrite: asTool<'fileWrite'>(fileWriteInputSchema, fileWriteOutputSchema),
  glob: asTool<'glob'>(globInputSchema, globOutputSchema),
  grep: asTool<'grep'>(grepInputSchema, grepOutputSchema),
  shell: asTool<'shell'>(shellInputSchema, shellOutputSchema),
  shellStart: asTool<'shellStart'>(shellStartInputSchema, shellSessionOutputOrErrorSchema),
  shellPoll: asTool<'shellPoll'>(shellPollInputSchema, shellSessionOutputOrErrorSchema),
  shellWrite: asTool<'shellWrite'>(shellWriteInputSchema, shellSessionOutputOrErrorSchema),
  shellStop: asTool<'shellStop'>(shellStopInputSchema, shellStopOutputSchema),
  shellList: asTool<'shellList'>(shellListInputSchema, shellListOutputSchema),
  spawn: asTool<'spawn'>(spawnInputSchema, spawnOutputSchema),
  await: asTool<'await'>(awaitInputSchema, awaitOutputSchema),
  tasks: asTool<'tasks'>(tasksInputSchema, tasksOutputSchema),
  steer: asTool<'steer'>(steerInputSchema, steerOutputSchema),
  cancel: asTool<'cancel'>(cancelTaskInputSchema, cancelTaskOutputSchema),
  report: asTool<'report'>(reportInputSchema, reportOutputSchema),
  skill: asTool<'skill'>(skillInputSchema, skillOutputSchema),
  web_search: asTool<'web_search'>(providerToolPayloadSchema, providerToolPayloadSchema),
  updateGoal: asTool<'updateGoal'>(updateGoalInputSchema, updateGoalOutputSchema),
  askQuestion: asTool<'askQuestion'>(askQuestionInputSchema, askQuestionOutputSchema),
  exitPlanMode: asTool<'exitPlanMode'>(exitPlanModeInputSchema, exitPlanModeOutputSchema),
  browserOpen: asTool<'browserOpen'>(browserOpenInputSchema, browserOpenOutputSchema),
  todo: asTool<'todo'>(todoInputSchema, todoOutputSchema)
} satisfies ValidationTools

const telemetryUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional()
})

const telemetryRetryReasonSchema = z.enum(['maxRetriesExceeded', 'errorNotRetryable', 'abort'])

const telemetryErrorSchema = z.object({
  kind: z.enum([
    'api',
    'retry',
    'abort',
    'configuration',
    'validation',
    'model',
    'provider',
    'tool',
    'stream',
    'content',
    'download',
    'unsupported',
    'unknown'
  ]),
  name: z.string().optional(),
  message: z.string(),
  statusCode: z.number().optional(),
  retryable: z.boolean().optional(),
  provider: z.string().optional(),
  modelId: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  reason: telemetryRetryReasonSchema.optional(),
  attempts: z.number().int().nonnegative().optional(),
  cause: z.object({ name: z.string().optional(), message: z.string() }).optional()
})

export const validationDataSchemas = {
  plan: z.object({
    steps: z.array(
      z.object({
        title: z.string(),
        status: z.enum(['pending', 'active', 'done'])
      })
    )
  }),
  fileDiff: z.object({ path: z.string(), before: z.string(), after: z.string() }),
  changePreview: z.object({
    changeSetId: z.string(),
    runId: z.string(),
    chatId: z.string(),
    assistantMessageId: z.string(),
    cwd: z.string(),
    beforeCheckpointId: z.string(),
    afterCheckpointId: z.string(),
    beforeTreeOid: z.string(),
    afterTreeOid: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'binary']),
        additions: z.number(),
        deletions: z.number(),
        binary: z.boolean().optional(),
        oldPath: z.string().optional(),
        diff: z.string().optional(),
        patchAvailable: z.boolean().optional()
      })
    ),
    fileCount: z.number(),
    additions: z.number(),
    deletions: z.number(),
    materialization: z.object({
      status: z.enum(['materialized', 'pending', 'partial', 'failed', 'skipped', 'unknown'])
    }),
    restoreRisk: z.object({
      code: z.enum(['none', 'low', 'medium', 'high', 'blocked']),
      message: z.string().optional()
    }),
    createdAt: z.string()
  }),
  status: z.object({ label: z.string() }),
  task: z.object({
    rootChatId: z.string(),
    tasks: z.array(z.unknown())
  }) as unknown as z.ZodType<TanzoDataParts['task']>,
  taskApproval: z.object({
    rootChatId: z.string(),
    approvals: z.array(z.unknown())
  }) as unknown as z.ZodType<TanzoDataParts['taskApproval']>,
  compaction: z.object({
    stage: z.enum(['start', 'complete', 'failed']),
    auto: z.boolean().optional(),
    summary: z.string().optional(),
    summaryId: z.string().optional(),
    beforeTokens: z.number().optional(),
    afterTokens: z.number().optional(),
    usage: telemetryUsageSchema.optional(),
    reducedTokens: z.number().optional(),
    reducedRatio: z.number().optional(),
    omittedMessages: z.number().optional(),
    toolResultPruning: z.boolean().optional()
  }),
  context: z.object({
    usedTokens: z.number().optional(),
    windowTokens: z.number().optional(),
    compactionTriggerTokens: z.number().optional(),
    compactionTriggered: z.boolean().optional(),
    source: z.enum(['unavailable', 'reported']),
    cacheKind: z.enum(['ephemeral', 'auto', 'unsupported']),
    serverCompaction: z.boolean(),
    hitRatio: z.number().optional()
  }),
  steering: z.object({
    text: z.string()
  }),
  queued: z.object({
    items: z.array(z.object({ id: z.string(), text: z.string() }))
  }),
  goal: z.object({
    goal: z
      .object({
        objective: z.string(),
        status: z.enum([
          'active',
          'paused',
          'blocked',
          'budget_limited',
          'usage_limited',
          'complete'
        ]),
        tokenBudget: z.number().nullable(),
        tokensUsed: z.number(),
        timeBudgetSeconds: z.number().nullable(),
        timeUsedSeconds: z.number()
      })
      .nullable()
  }),
  telemetry: z.object({
    event: z.enum([
      'operation-start',
      'operation-finish',
      'operation-error',
      'step-start',
      'step-finish',
      'model-call-start',
      'model-call-finish',
      'tool-start',
      'tool-finish',
      'retry-attempt',
      'retry-exhausted',
      'chunk-summary',
      'embed-start',
      'embed-finish',
      'rerank-start',
      'rerank-finish'
    ]),
    runId: z.string(),
    scope: z.enum(['chat', 'compaction', 'tool', 'embed', 'rerank', 'unknown']),
    sequence: z.number().int().nonnegative(),
    timestamp: z.number(),
    chatId: z.string().optional(),
    operationId: z.string().optional(),
    callId: z.string().optional(),
    stepNumber: z.number().int().nonnegative().optional(),
    provider: z.string().optional(),
    modelId: z.string().optional(),
    durationMs: z.number().optional(),
    usage: telemetryUsageSchema.optional(),
    tool: z
      .object({
        name: z.string().optional(),
        callId: z.string().optional(),
        success: z.boolean().optional(),
        durationMs: z.number().optional()
      })
      .optional(),
    retry: z
      .object({
        attempt: z.number().int().positive(),
        attempts: z.number().int().nonnegative().optional(),
        maxRetries: z.number().int().nonnegative().optional(),
        reason: telemetryRetryReasonSchema.optional(),
        lastMessage: z.string().optional(),
        retryable: z.boolean().optional()
      })
      .optional(),
    chunks: z
      .object({
        count: z.number().int().nonnegative(),
        firstTimestamp: z.number().optional(),
        lastTimestamp: z.number().optional(),
        firstChunkMs: z.number().optional(),
        durationMs: z.number().optional()
      })
      .optional(),
    error: telemetryErrorSchema.optional()
  })
} satisfies {
  [K in keyof TanzoDataParts]: z.ZodType<TanzoDataParts[K]>
}
