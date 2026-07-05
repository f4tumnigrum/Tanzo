import type { AskQuestionInput } from './agent-message'

export type SubagentTaskStatus = 'pending' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled'

export interface SubagentTaskPhase {
  name: string
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
  /** Whether the result was submitted via an explicit `report(result:...)` call or
   *  inferred from the last assistant text when the sub-agent terminated without one. */
  resultSource?: 'explicit' | 'inferred'
  /** Distinguishes app-restart interruptions from genuine logic failures so the UI
   *  can offer targeted recovery actions (e.g. "retry interrupted tasks"). */
  failureKind?: 'app-restart' | 'logic-error'
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
  result?: SubagentTaskResult
  createdAt: number
  startedAt?: number
  completedAt?: number
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

/**
 * Result of steering (instruct/redefine) a task. Steering is rejected when the
 * task is settled (its result is final) or dependency-blocked (the gate may
 * not be bypassed).
 */
export type SteerTaskOutcome =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'terminal' | 'dependency-blocked' }
