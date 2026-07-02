import type { UIMessage } from 'ai'
import type { ChangePreviewData } from './change-set'
import type {
  SubagentTask,
  SubagentTaskApprovalView,
  SubagentTaskResult,
  SubagentTaskStatus
} from './subagent-task'

export type ToolError = { error: true; message: string }

export type SubagentTraceEntry = { type: 'text'; text: string } | { type: 'tool'; toolName: string }

type SubagentTaskWire = SubagentTask
type SubagentTaskResultWire = SubagentTaskResult
type SubagentTaskStatusWire = SubagentTaskStatus

export interface AskQuestionOption {
  value: string
  label: string
  description?: string
}

export type AskQuestionType = 'single_select' | 'multi_select' | 'rank_priorities'

export interface AskQuestionItem {
  id: string
  title: string
  prompt: string
  type: AskQuestionType
  options: AskQuestionOption[]
  allowCustom?: boolean
}

export interface AskQuestionInput {
  questions: AskQuestionItem[]
}

export interface AskQuestionAnswer {
  id: string
  type: AskQuestionType
  values: string[]
  labels?: string[]
  custom: boolean
}

export interface AskQuestionAnswered {
  answers: AskQuestionAnswer[]
}

export interface AskQuestionDeclined {
  declined: true
  note?: string
}

export type AskQuestionOutput = AskQuestionAnswered | AskQuestionDeclined

export type TanzoTools = {
  fileRead: {
    input: { path: string; startLine?: number; lineCount?: number }
    output:
      | {
          content: string
          totalLines: number
          totalLinesKnown?: boolean
          hasMore?: boolean
          truncated: boolean
        }
      | { kind: 'image'; data: string; mediaType: string; bytes: number }
      | { kind: 'notebook'; content: string; cells: number; truncated: boolean }
      | ToolError
  }
  fileEdit: {
    input: { path: string; oldText: string; newText: string; replaceAll?: boolean }
    output: { applied: boolean; replacements: number; startLine?: number } | ToolError
  }
  multiEdit: {
    input: {
      path: string
      edits: Array<{ oldText: string; newText: string; replaceAll?: boolean }>
    }
    output:
      | {
          applied: boolean
          edits: number
          replacements: number
          locations?: Array<{ startLine: number; startLines?: number[] }>
        }
      | ToolError
  }
  fileWrite: {
    input: { path: string; content: string }
    output: { applied: boolean; bytes: number } | ToolError
  }
  glob: {
    input: {
      pattern: string
      directory?: string
      includeIgnored?: boolean
      offset?: number
      limit?: number
    }
    output: { paths: string[]; truncated: boolean } | ToolError
  }
  grep: {
    input: {
      pattern: string
      directory?: string
      includeGlob?: string
      includeIgnored?: boolean
      mode?: 'content' | 'files' | 'count'
      caseInsensitive?: boolean
      contextBefore?: number
      contextAfter?: number
      type?: string | null
      multiline?: boolean
      limit?: number
      offset?: number
    }
    output:
      | {
          mode: 'content'
          matches: Array<{ file: string; line: number; text: string }>
          truncated: boolean
        }
      | { mode: 'files'; files: string[]; truncated: boolean }
      | { mode: 'count'; count: number }
      | ToolError
  }
  shell: {
    input: { command: string; workdir?: string; timeoutMs?: number }
    output: {
      stdout: string
      stderr: string
      code: number
      reason?: 'exit' | 'error' | 'timeout' | 'abort' | 'closed'
    }
  }
  shellStart: {
    input: { command: string; workdir?: string; timeoutMs?: number; yieldTimeMs?: number }
    output: ShellSessionOutput | ToolError
  }
  shellPoll: {
    input: { sessionId: string; yieldTimeMs?: number }
    output: ShellSessionOutput | ToolError
  }
  shellWrite: {
    input: { sessionId: string; input: string; yieldTimeMs?: number }
    output: ShellSessionOutput | ToolError
  }
  shellStop: {
    input: { sessionId: string }
    output: { stopped: true; sessionId: string } | ToolError
  }
  shellList: {
    input: Record<string, never>
    output: { sessions: ShellSessionListItem[] } | ToolError
  }
  spawn: {
    input: { tasks: Array<{ objective: string; agent: string; dependsOn?: string[] }> }
    output: { tasks: Array<{ task: string; status: SubagentTaskStatusWire }> } | ToolError
  }
  await: {
    input: { tasks: string[]; settle?: 'all' | 'first'; timeoutMs?: number }
    output:
      | {
          results: Array<{ task: string; result: SubagentTaskResultWire }>
          pending?: string[]
          timedOut?: boolean
        }
      | ToolError
  }
  tasks: {
    input: { task?: string; status?: SubagentTaskStatusWire }
    output: { tasks: SubagentTaskWire[] } | ToolError
  }
  steer: {
    input: { task: string; instruction?: string; objective?: string }
    output: { steered: true; mode: 'instructed' | 'redefined' } | ToolError
  }
  cancel: {
    input: { task: string }
    output: { cancelled: true } | ToolError
  }
  report: {
    input: { phase?: string; result?: string }
    output: { ok: true } | ToolError
  }
  skill: {
    input: { skill: string; args?: string }
    output:
      | {
          instructions: string
          skillDir: string
          args: string | null
          allowedTools: string[] | null
        }
      | ToolError
  }
  web_search: {
    input: unknown
    output: unknown
  }
  updateGoal: {
    input: { status: 'complete' | 'blocked' }
    output: { updated: true; status: 'complete' | 'blocked' } | ToolError
  }
  askQuestion: {
    input: AskQuestionInput
    output: AskQuestionOutput | ToolError
  }
  todo: {
    input: {
      items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
    }
    output:
      | {
          ok: true
          items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
          counts: { pending: number; in_progress: number; completed: number }
          normalized?: string
          dropped?: string[]
        }
      | ToolError
  }
  exitPlanMode: {
    input: { plan: string }
    output: { acknowledged: true; message: string } | ToolError
  }
  browserOpen: {
    input: { url: string }
    output: { url: string; opened: boolean } | ToolError
  }
}

export type ShellSessionStatus = 'running' | 'exited' | 'failed' | 'stopped'

export type ShellSessionOutput = {
  sessionId: string
  chatId: string
  command: string
  cwd: string
  status: ShellSessionStatus
  stdout: string
  stderr: string
  exitCode: number | null
  reason?: 'exit' | 'error' | 'timeout' | 'abort' | 'closed'
  startedAt: number
  updatedAt: number
  truncated: boolean
}

export type ShellSessionListItem = Omit<
  ShellSessionOutput,
  'chatId' | 'stdout' | 'stderr' | 'truncated'
>

export type TanzoToolUI = TanzoTools

/**
 * A user message waiting to be dispatched after the current turn ends. The `id`
 * is a session-stable handle minted when the message is queued; it is used by
 * the renderer to remove a specific entry without index races and is not
 * persisted (the durable store keeps only ordered text).
 */
export type QueuedMessage = { id: string; text: string }

export type TanzoDataParts = {
  plan: { steps: Array<{ title: string; status: 'pending' | 'active' | 'done' }> }
  fileDiff: { path: string; before: string; after: string }
  changePreview: ChangePreviewData
  status: { label: string }
  task: { rootChatId: string; tasks: SubagentTask[] }
  taskApproval: { rootChatId: string; approvals: SubagentTaskApprovalView[] }

  compaction: {
    stage: 'start' | 'complete' | 'failed'
    auto?: boolean
    summary?: string
    summaryId?: string
    beforeTokens?: number
    afterTokens?: number
    usage?: TanzoUsageMetadata
    reducedTokens?: number
    reducedRatio?: number
    omittedMessages?: number
    toolResultPruning?: boolean
  }

  context: {
    usedTokens?: number
    windowTokens?: number
    compactionTriggerTokens?: number
    compactionTriggered?: boolean
    source: 'unavailable' | 'reported' | 'estimated'
    cacheKind: 'ephemeral' | 'auto' | 'unsupported'
    serverCompaction: boolean

    hitRatio?: number
  }

  steering: { text: string }

  queued: { items: QueuedMessage[] }

  goal: {
    goal: {
      objective: string
      status: 'active' | 'paused' | 'blocked' | 'budget_limited' | 'usage_limited' | 'complete'
      tokenBudget: number | null
      tokensUsed: number
      timeBudgetSeconds: number | null
      timeUsedSeconds: number
    } | null
  }

  telemetry: {
    event:
      | 'operation-start'
      | 'operation-finish'
      | 'operation-error'
      | 'step-start'
      | 'step-finish'
      | 'model-call-start'
      | 'model-call-finish'
      | 'tool-start'
      | 'tool-finish'
      | 'retry-attempt'
      | 'retry-exhausted'
      | 'chunk-summary'
      | 'embed-start'
      | 'embed-finish'
      | 'rerank-start'
      | 'rerank-finish'
    runId: string
    scope: 'chat' | 'compaction' | 'tool' | 'embed' | 'rerank' | 'unknown'
    sequence: number
    timestamp: number
    chatId?: string
    operationId?: string
    callId?: string
    stepNumber?: number
    provider?: string
    modelId?: string
    durationMs?: number
    usage?: TanzoUsageMetadata
    tool?: {
      name?: string
      callId?: string
      success?: boolean
      durationMs?: number
    }
    retry?: {
      attempt: number
      attempts?: number
      maxRetries?: number
      reason?: 'maxRetriesExceeded' | 'errorNotRetryable' | 'abort'
      lastMessage?: string
      retryable?: boolean
    }
    chunks?: {
      count: number
      firstTimestamp?: number
      lastTimestamp?: number
      firstChunkMs?: number
      durationMs?: number
    }
    error?: {
      kind:
        | 'api'
        | 'retry'
        | 'abort'
        | 'configuration'
        | 'validation'
        | 'model'
        | 'provider'
        | 'tool'
        | 'stream'
        | 'content'
        | 'download'
        | 'unsupported'
        | 'unknown'
      name?: string
      message: string
      statusCode?: number
      retryable?: boolean
      provider?: string
      modelId?: string
      toolName?: string
      toolCallId?: string
      reason?: 'maxRetriesExceeded' | 'errorNotRetryable' | 'abort'
      attempts?: number
      cause?: {
        name?: string
        message: string
      }
    }
  }
}

export type TanzoUsageMetadata = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type TanzoStepUsageMetadata = {
  stepNumber: number
  usage?: TanzoUsageMetadata | null
  finishReason?: string | null
  providerMetadata?: Record<string, unknown> | null
}

export type TanzoMetadata = {
  createdAt?: number
  usage?: TanzoUsageMetadata
  steps?: TanzoStepUsageMetadata[]
}

export type TanzoUIMessage = UIMessage<TanzoMetadata, TanzoDataParts, TanzoToolUI>
