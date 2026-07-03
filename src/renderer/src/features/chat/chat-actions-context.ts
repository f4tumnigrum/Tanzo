import { createContext, useContext } from 'react'
import type { AskQuestionAnswer } from '@shared/agent-message'
import type { SubagentTaskApprovalResponse, SubagentTaskApprovalScope } from '@shared/subagent-task'

export type ApprovalScope = SubagentTaskApprovalScope

export interface ApprovalDecision {
  approvalId: string
  approved: boolean
  reason?: string
  saveAs?: { scope: 'session' | 'forever'; matcher: { toolName: string } }
}

export type QuestionDecision = { questionId: string } & (
  { declined?: false; answers: AskQuestionAnswer[] } | { declined: true; note?: string }
)

export interface ChatActions {
  chatId: string
  respondToApprovals(decisions: ApprovalDecision[]): Promise<void>
  respondToTaskApproval(decision: SubagentTaskApprovalResponse): Promise<void>
  respondToQuestion(decision: QuestionDecision): Promise<void>
}

const ChatActionsContext = createContext<ChatActions | null>(null)

export const ChatActionsProvider = ChatActionsContext.Provider

export function useChatActions(): ChatActions | null {
  return useContext(ChatActionsContext)
}
