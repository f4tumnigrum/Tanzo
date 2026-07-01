import { z } from 'zod/v4'

export const toolErrorSchema = z.object({ error: z.literal(true), message: z.string() })

const WORKSPACE_PATH_NOTE =
  'Relative paths resolve inside the workspace; absolute paths outside the workspace require dangerous mode.'

export const GREP_HEAD_MAX = 500
export const GLOB_LIMIT_MAX = 500
export const FILE_READ_MAX_LIMIT = 2000
export const SHELL_MIN_TIMEOUT_MS = 1_000
export const SHELL_MAX_TIMEOUT_MS = 30 * 60_000

export const fileReadInputSchema = z
  .object({
    path: z.string().min(1).describe(`File path. ${WORKSPACE_PATH_NOTE}`),
    startLine: z.number().int().min(1).optional().describe('1-based first line to return.'),
    lineCount: z
      .number()
      .int()
      .min(1)
      .max(FILE_READ_MAX_LIMIT)
      .optional()
      .describe('Maximum number of lines to return.')
  })
  .strict()

export const fileReadOutputSchema = z.union([
  z.object({
    content: z.string(),
    totalLines: z.number(),
    totalLinesKnown: z.boolean().optional(),
    hasMore: z.boolean().optional(),
    truncated: z.boolean()
  }),
  z.object({
    kind: z.literal('image'),
    data: z.string(),
    mediaType: z.string(),
    bytes: z.number()
  }),
  z.object({
    kind: z.literal('notebook'),
    content: z.string(),
    cells: z.number(),
    truncated: z.boolean()
  }),
  toolErrorSchema
])

export const fileEditInputSchema = z
  .object({
    path: z.string().min(1).describe(`Text file path. ${WORKSPACE_PATH_NOTE}`),
    oldText: z.string().min(1).describe('Exact text to replace. Include context for uniqueness.'),
    newText: z.string().describe('Replacement text.'),
    replaceAll: z
      .boolean()
      .optional()
      .describe('Replace every match instead of requiring one match.')
  })
  .strict()

export const fileEditOutputSchema = z.union([
  z.object({ applied: z.boolean(), replacements: z.number(), startLine: z.number().optional() }),
  toolErrorSchema
])

export const multiEditInputSchema = z
  .object({
    path: z.string().min(1).describe(`Text file path. ${WORKSPACE_PATH_NOTE}`),
    edits: z
      .array(
        z
          .object({
            oldText: z.string().min(1).describe('Exact text to replace after previous edits.'),
            newText: z.string().describe('Replacement text.'),
            replaceAll: z.boolean().optional().describe('Replace every match for this edit.')
          })
          .strict()
      )
      .min(1)
      .max(100)
      .describe('Ordered replacements. The operation writes nothing if any edit fails.')
  })
  .strict()

export const multiEditOutputSchema = z.union([
  z.object({
    applied: z.boolean(),
    edits: z.number(),
    replacements: z.number(),
    locations: z
      .array(
        z.object({
          startLine: z.number(),
          startLines: z.array(z.number()).optional()
        })
      )
      .optional()
  }),
  toolErrorSchema
])

export const fileWriteInputSchema = z
  .object({
    path: z.string().min(1).describe(`File path to create or overwrite. ${WORKSPACE_PATH_NOTE}`),
    content: z.string().describe('Complete file content to write.')
  })
  .strict()

export const fileWriteOutputSchema = z.union([
  z.object({ applied: z.boolean(), bytes: z.number() }),
  toolErrorSchema
])

export const globInputSchema = z
  .object({
    pattern: z.string().min(1).describe('Glob pattern such as "src/**/*.ts".'),
    directory: z
      .string()
      .min(1)
      .optional()
      .describe(`Directory to search within. ${WORKSPACE_PATH_NOTE}`),
    includeIgnored: z.boolean().optional().describe('Include files ignored by gitignore rules.'),
    offset: z.number().int().min(0).optional().describe('Number of matched paths to skip.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(GLOB_LIMIT_MAX)
      .optional()
      .describe('Maximum number of matched paths to return.')
  })
  .strict()

export const globOutputSchema = z.union([
  z.object({ paths: z.array(z.string()), truncated: z.boolean() }),
  toolErrorSchema
])

export const grepInputSchema = z
  .object({
    pattern: z.string().min(1).describe('Regular expression to search for.'),
    directory: z
      .string()
      .min(1)
      .optional()
      .describe(`Directory or file to search within. ${WORKSPACE_PATH_NOTE}`),
    includeGlob: z.string().min(1).optional().describe('Ripgrep glob filter, e.g. "*.ts".'),
    includeIgnored: z.boolean().optional().describe('Include files ignored by gitignore rules.'),
    mode: z
      .enum(['content', 'files', 'count'])
      .optional()
      .describe('Return matching lines, matching file paths, or only the total count.'),
    caseInsensitive: z.boolean().optional().describe('Ignore case while matching.'),
    contextBefore: z.number().int().min(0).max(20).optional().describe('Lines before each match.'),
    contextAfter: z.number().int().min(0).max(20).optional().describe('Lines after each match.'),
    type: z
      .union([z.string().min(1), z.null()])
      .optional()
      .describe(
        'Restrict to a ripgrep language type (e.g. "ts", "js", "py", "md"). ' +
          'Do not use this for file extensions; use includeGlob instead. Use null for no type filter.'
      ),
    multiline: z.boolean().optional().describe('Allow the regex to match across line breaks.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(GREP_HEAD_MAX)
      .optional()
      .describe('Maximum number of matches or files to return.'),
    offset: z.number().int().min(0).optional().describe('Number of matches or files to skip.')
  })
  .strict()

export const grepOutputSchema = z.union([
  z.object({
    mode: z.literal('content'),
    matches: z.array(z.object({ file: z.string(), line: z.number(), text: z.string() })),
    truncated: z.boolean()
  }),
  z.object({ mode: z.literal('files'), files: z.array(z.string()), truncated: z.boolean() }),
  z.object({ mode: z.literal('count'), count: z.number() }),
  toolErrorSchema
])

export const shellInputSchema = z
  .object({
    command: z
      .string()
      .trim()
      .min(1)
      .describe('Shell command to execute with the platform-compatible shell runner.'),
    workdir: z
      .string()
      .min(1)
      .optional()
      .describe(`Working directory. ${WORKSPACE_PATH_NOTE} Omit for the workspace root.`),
    timeoutMs: z
      .number()
      .int()
      .min(SHELL_MIN_TIMEOUT_MS)
      .max(SHELL_MAX_TIMEOUT_MS)
      .optional()
      .describe('Timeout in milliseconds.')
  })
  .strict()

export const shellOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  code: z.number(),
  reason: z.enum(['exit', 'error', 'timeout', 'abort', 'closed']).optional()
})

const shellSessionStatusSchema = z.enum(['running', 'exited', 'failed', 'stopped'])
const shellSessionReasonSchema = z.enum(['exit', 'error', 'timeout', 'abort', 'closed'])

export const shellStartInputSchema = z
  .object({
    command: z.string().trim().min(1).describe('Shell command to start in the background.'),
    workdir: z
      .string()
      .min(1)
      .optional()
      .describe('Working directory. Omit for the workspace root.'),
    timeoutMs: z.number().int().min(SHELL_MIN_TIMEOUT_MS).max(SHELL_MAX_TIMEOUT_MS).optional(),
    yieldTimeMs: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .optional()
      .describe('How long to wait for initial output before returning.')
  })
  .strict()

export const shellSessionOutputSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  command: z.string(),
  cwd: z.string(),
  status: shellSessionStatusSchema,
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  reason: shellSessionReasonSchema.optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  truncated: z.boolean()
})

export const shellPollInputSchema = z
  .object({
    sessionId: z.string().min(1).describe('Shell session id returned by shellStart.'),
    yieldTimeMs: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .optional()
      .describe('How long to wait for new output before returning.')
  })
  .strict()

export const shellWriteInputSchema = z
  .object({
    sessionId: z.string().min(1).describe('Shell session id returned by shellStart.'),
    input: z.string().describe('Text to write to stdin. Include a trailing newline when needed.'),
    yieldTimeMs: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .optional()
      .describe('How long to wait for output after writing.')
  })
  .strict()

export const shellStopInputSchema = z
  .object({ sessionId: z.string().min(1).describe('Shell session id returned by shellStart.') })
  .strict()

export const shellListInputSchema = z.object({}).strict()

export const shellSessionOutputOrErrorSchema = z.union([shellSessionOutputSchema, toolErrorSchema])

export const shellStopOutputSchema = z.union([
  z.object({ stopped: z.literal(true), sessionId: z.string() }),
  toolErrorSchema
])

export const shellListOutputSchema = z.union([
  z.object({
    sessions: z.array(
      shellSessionOutputSchema.omit({
        chatId: true,
        stdout: true,
        stderr: true,
        truncated: true
      })
    )
  }),
  toolErrorSchema
])

const subagentTaskStatusSchema = z.enum([
  'pending',
  'running',
  'blocked',
  'done',
  'failed',
  'cancelled'
])

const subagentTaskResultSchema = z.object({
  summary: z.string(),
  failed: z.boolean().optional(),
  errorMessage: z.string().optional()
})

const subagentTaskBlockSchema = z.union([
  z.object({
    kind: z.literal('approval'),
    approvals: z.array(
      z.object({
        approvalId: z.string(),
        toolName: z.string(),
        input: z.unknown(),
        reason: z.string().optional()
      })
    )
  }),
  z.object({ kind: z.literal('dependency'), taskIds: z.array(z.string()) })
])

const subagentTaskSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  parentChatId: z.string(),
  rootChatId: z.string(),
  agentType: z.string(),
  objective: z.string(),
  status: subagentTaskStatusSchema,
  dependsOn: z.array(z.string()),
  allowedTools: z.array(z.string()).nullable(),
  block: subagentTaskBlockSchema.optional(),
  phase: z.string().optional(),
  phases: z.array(z.object({ name: z.string(), at: z.number() })),
  result: subagentTaskResultSchema.optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional()
})

export const SUBAGENT_AWAIT_MAX_TIMEOUT_MS = 60 * 60_000

const spawnTaskSpecSchema = z
  .object({
    objective: z
      .string()
      .min(1)
      .describe(
        'Self-contained task for the sub-agent: goal, relevant files, constraints, expected output.'
      ),
    agent: z
      .string()
      .min(1)
      .describe('Sub-agent type. Choose an available type; do not invent values.'),
    dependsOn: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Ids of already-spawned tasks that must finish first (e.g. ["explore-1"]). ' +
          'Use for pipelines; omit for independent work.'
      )
  })
  .strict()

export const spawnInputSchema = z
  .object({
    tasks: z
      .array(spawnTaskSpecSchema)
      .min(1)
      .describe(
        'One or more sub-agent tasks to spawn concurrently. Put independent work in a single ' +
          'call so it runs in parallel.'
      )
  })
  .strict()

export const spawnOutputSchema = z.union([
  z.object({
    tasks: z.array(z.object({ task: z.string(), status: subagentTaskStatusSchema }))
  }),
  toolErrorSchema
])

export const awaitInputSchema = z
  .object({
    tasks: z.array(z.string().min(1)).min(1).describe('Task ids to wait for, e.g. ["explore-1"].'),
    settle: z
      .enum(['all', 'first'])
      .optional()
      .describe('Return when all tasks finish (default) or as soon as the first one finishes.'),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(SUBAGENT_AWAIT_MAX_TIMEOUT_MS)
      .optional()
      .describe(
        'Give up waiting after this many ms and return whatever has settled, instead of ' +
          'blocking indefinitely. Tasks keep running; await them again later.'
      )
  })
  .strict()

export const awaitOutputSchema = z.union([
  z.object({
    results: z.array(z.object({ task: z.string(), result: subagentTaskResultSchema })),
    pending: z.array(z.string()).optional(),
    timedOut: z.boolean().optional()
  }),
  toolErrorSchema
])

export const tasksInputSchema = z
  .object({
    task: z.string().min(1).optional().describe('Inspect a single task by id. Omit to list tasks.'),
    status: subagentTaskStatusSchema
      .optional()
      .describe('Filter the list by status (ignored when task is set).')
  })
  .strict()

export const tasksOutputSchema = z.union([
  z.object({ tasks: z.array(subagentTaskSchema) }),
  toolErrorSchema
])

export const steerInputSchema = z
  .object({
    task: z.string().min(1).describe('Task id to steer.'),
    instruction: z
      .string()
      .min(1)
      .optional()
      .describe('Extra guidance appended to the running task without restarting it.'),
    objective: z
      .string()
      .min(1)
      .optional()
      .describe('Replacement objective; providing this restarts the task from scratch.')
  })
  .strict()

export const steerOutputSchema = z.union([
  z.object({ steered: z.literal(true), mode: z.enum(['instructed', 'redefined']) }),
  toolErrorSchema
])

export const cancelTaskInputSchema = z
  .object({ task: z.string().min(1).describe('Task id to cancel.') })
  .strict()

export const cancelTaskOutputSchema = z.union([
  z.object({ cancelled: z.literal(true) }),
  toolErrorSchema
])

export const reportInputSchema = z
  .object({
    phase: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('Short label for the step you are starting.'),
    result: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Concise, self-contained final deliverable for the parent. Providing this records your ' +
          'result snapshot — call it once you have the answer, then stop.'
      )
  })
  .strict()

export const reportOutputSchema = z.union([z.object({ ok: z.literal(true) }), toolErrorSchema])

export const skillInputSchema = z
  .object({
    skill: z.string().min(1).describe('Exact skill name from the Available Skills list.'),
    args: z
      .string()
      .min(1)
      .optional()
      .describe('Optional short note about the variant, framework, or file type you need.')
  })
  .strict()

export const skillOutputSchema = z.union([
  z.object({
    instructions: z.string(),
    skillDir: z.string(),
    args: z.string().nullable(),
    allowedTools: z.array(z.string()).nullable()
  }),
  toolErrorSchema
])

export const updateGoalInputSchema = z
  .object({
    status: z
      .enum(['complete', 'blocked'])
      .describe('New terminal goal status: achieved or genuinely blocked.')
  })
  .strict()

export const updateGoalOutputSchema = z.union([
  z.object({ updated: z.literal(true), status: z.enum(['complete', 'blocked']) }),
  toolErrorSchema
])

const askQuestionIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case ids.')

export const askQuestionTypeSchema = z.enum(['single_select', 'multi_select', 'rank_priorities'])

const askQuestionOptionSchema = z
  .object({
    value: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(160).optional()
  })
  .strict()

const askQuestionItemSchema = z
  .object({
    id: askQuestionIdSchema,
    title: z.string().min(1).max(40),
    prompt: z.string().min(1).max(500),
    type: askQuestionTypeSchema.default('single_select'),
    options: z.array(askQuestionOptionSchema).min(2).max(8),
    allowCustom: z.boolean().optional()
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.type === 'rank_priorities' && item.allowCustom) {
      ctx.addIssue({
        code: 'custom',
        message: 'rank_priorities questions cannot allow custom answers.'
      })
    }
    const seen = new Set<string>()
    for (const option of item.options) {
      if (seen.has(option.value)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate option value "${option.value}".` })
      }
      seen.add(option.value)
    }
  })

export const askQuestionInputSchema = z
  .object({
    questions: z.array(askQuestionItemSchema).min(1).max(3)
  })
  .strict()

const askQuestionAnswerSchema = z
  .object({
    id: askQuestionIdSchema,
    type: askQuestionTypeSchema,
    values: z.array(z.string().min(1).max(2000)).min(1).max(16),
    labels: z.array(z.string().min(1).max(200)).optional(),
    custom: z.boolean()
  })
  .strict()

export const askQuestionOutputSchema = z.union([
  z.object({ answers: z.array(askQuestionAnswerSchema).min(1).max(3) }),
  z.object({
    declined: z.literal(true),
    note: z.string().min(1).max(2000).optional()
  }),
  toolErrorSchema
])

const todoItemSchema = z
  .object({
    content: z.string().trim().min(1).describe('Imperative description, e.g. "Run the tests".'),
    status: z.enum(['pending', 'in_progress', 'completed'])
  })
  .strict()

export const todoInputSchema = z.object({ items: z.array(todoItemSchema) }).strict()

export const todoOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    items: z.array(todoItemSchema),
    counts: z.object({
      pending: z.number(),
      in_progress: z.number(),
      completed: z.number()
    }),
    normalized: z.string().optional(),
    dropped: z.array(z.string()).optional()
  }),
  toolErrorSchema
])

export const exitPlanModeInputSchema = z
  .object({
    plan: z
      .string()
      .trim()
      .min(1)
      .describe(
        'The complete, executable implementation plan in markdown. Include context, files to ' +
          'change, functions to reuse, and how to verify.'
      )
  })
  .strict()

export const exitPlanModeOutputSchema = z.union([
  z.object({ acknowledged: z.literal(true), message: z.string() }),
  toolErrorSchema
])

// --- Embedded browser ---------------------------------------------------------

export const browserOpenInputSchema = z
  .object({
    url: z.string().min(1).describe('Absolute http(s) URL to open in the built-in browser.')
  })
  .strict()

export const browserOpenOutputSchema = z.union([
  z.object({ url: z.string(), opened: z.boolean() }),
  toolErrorSchema
])
