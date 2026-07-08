import type { AskQuestionInput } from './agent-message'

export type SubagentTaskStatus = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled'

export interface SubagentTaskPhase {
  name: string
  at: number
}

export interface SubagentTaskNote {
  text: string
  at: number
}

export interface SubagentTaskApproval {
  approvalId: string
  toolName: string
  input: unknown
  reason?: string
}

export type SubagentTaskBlock =
  | { kind: 'approval'; approvals: SubagentTaskApproval[] }
  | { kind: 'dependency'; taskIds: string[] }

export interface SubagentTaskResult {
  summary: string
  failed?: boolean
  errorMessage?: string

  resultSource?: 'explicit' | 'inferred'

  failureKind?: 'app-restart' | 'logic-error' | 'await-cancelled'

  failedDependencyId?: string

  notes?: SubagentTaskNote[]
}

export interface SubagentTask {
  id: string
  chatId: string
  parentChatId: string
  rootChatId: string
  agentType: string
  objective: string
  status: SubagentTaskStatus
  dependsOn: string[]
  allowedTools: string[] | null
  block?: SubagentTaskBlock
  phase?: string
  phases: SubagentTaskPhase[]
  notes: SubagentTaskNote[]
  result?: SubagentTaskResult
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface SubagentTaskPendingView {
  task: string
  status: SubagentTaskStatus
  phase?: string
  latestNote?: string
  updatedAt: number
}

export interface SubagentTaskApprovalView {
  taskId: string
  rootChatId: string
  chatId: string
  agentType: string
  objective: string
  allowedTools: string[] | null
  phase?: string
  approval: SubagentTaskApproval
}

export type SubagentTaskApprovalScope = 'once' | 'session' | 'forever'

export interface SubagentTaskApprovalResponse {
  approvalId: string
  approved: boolean
  reason?: string
  scope?: SubagentTaskApprovalScope
  suggestion?: { kind: 'retry' | 'amend' | 'skip' | 'abort'; detail?: string }
}

export interface PendingTaskQuestion {
  chatId: string
  questionId: string
  input: AskQuestionInput
}

export type SteerTaskOutcome =
  { ok: true } | { ok: false; reason: 'not-found' | 'terminal' | 'dependency-blocked' }
