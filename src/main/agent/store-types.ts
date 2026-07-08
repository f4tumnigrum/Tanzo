import type {
  WorkspaceSummary,
  ConversationParentRelation,
  ConversationSummary,
  ChatRunOutcome,
  ForkConversationInput,
  ForkConversationResult,
  NewConversationInput
} from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import type {
  ActivityRange,
  ActivityConversationList,
  ActivityRunDetail,
  ActivityRunList,
  ActivityRunPage,
  ActivitySummary,
  ActivityTrend,
  ActivityReliability
} from '@shared/activity'
import type { AgentDefinition } from './agents/types'
import type {
  PromptCacheDiagnosticFinish,
  PromptCacheDiagnosticRecord,
  PromptDiagnosticPrevious
} from './diagnostics/prompt-cache'
import type { ToolExecutionRecord } from './repositories/tool-execution-repo'
import type { ModelCallRecord } from './repositories/model-call-repo'
import type { RunOutcomeAggregates } from './repositories/prompt-diagnostic-repo'
import type { SubagentTaskRepo } from './repositories/subagent-task-repo'

export interface AgentStore {
  transaction<T>(fn: () => T): T
  createConversation(input: NewConversationInput): ConversationSummary
  ensureConversation(id: string, input?: NewConversationInput): ConversationSummary
  forkConversation(input: ForkConversationInput): Promise<ForkConversationResult>
  listConversations(): ConversationSummary[]
  listWorkspaces(): WorkspaceSummary[]
  listChildren(parentChatId: string, relation?: ConversationParentRelation): ConversationSummary[]
  getConversation(chatId: string): ConversationSummary | undefined
  depthOf(chatId: string): number
  rootOf(chatId: string): string
  deleteWorkspace(workspaceId: string): void
  deleteConversation(chatId: string): void
  setConversationModel(chatId: string, modelRef: string): ConversationSummary
  setConversationTitle(chatId: string, title: string): ConversationSummary
  setConversationSubagentModel(chatId: string, modelRef: string): ConversationSummary
  setConversationReasoningEffort(chatId: string, effort: string): ConversationSummary
  setConversationAgent(chatId: string, agentId: string): ConversationSummary
  setConversationPinned(chatId: string, pinned: boolean): ConversationSummary
  save(chatId: string, messages: TanzoUIMessage[]): void

  finalizeCompaction(
    chatId: string,
    archivedIds: string[],
    summaryId: string,
    next: TanzoUIMessage[],
    expectedActiveIds?: string[]
  ): void
  load(chatId: string): Promise<TanzoUIMessage[]>
  loadFullHistory(chatId: string): Promise<TanzoUIMessage[]>
  loadDisplay(chatId: string): Promise<TanzoUIMessage[]>
  loadUnvalidated(chatId: string): TanzoUIMessage[]

  loadArchived(chatId: string, summaryId: string): Promise<TanzoUIMessage[]>
  resolveAgentDefinition(chatId: string): Promise<AgentDefinition>

  getLatestPromptDiagnostic(chatId: string): PromptDiagnosticPrevious | undefined
  ensureRunStep(input: {
    conversationId: string
    runId: string
    stepNumber: number
    modelRef: string
    provider: string
    createdAt: number
  }): void
  recordPromptDiagnostic(record: PromptCacheDiagnosticRecord): void
  finishPromptDiagnostic(finish: PromptCacheDiagnosticFinish): void

  markRunOutcome(
    chatId: string,
    runId: string,
    status: 'finished' | 'failed',
    errorJson?: string,
    aggregates?: RunOutcomeAggregates
  ): void
  getLatestRunOutcome(chatId: string): ChatRunOutcome | null
  sweepInterruptedRuns(): number
  pruneActivityHistory(olderThanMs: number): void

  listAllQueuedMessages(): Array<{ chatId: string; items: string[] }>
  saveQueuedMessages(chatId: string, items: string[]): void
  tasks: SubagentTaskRepo

  recordToolExecution(record: ToolExecutionRecord): void
  recordModelCall(record: ModelCallRecord): void

  getActivitySummary(range: ActivityRange): ActivitySummary
  getActivityTrend(range: ActivityRange): ActivityTrend
  getActivityReliability(range: ActivityRange): ActivityReliability
  listActivityConversations(range: ActivityRange, page: ActivityRunPage): ActivityConversationList
  listActivityRuns(range: ActivityRange, page: ActivityRunPage): ActivityRunList
  getActivityRunDetail(runId: string): ActivityRunDetail
}
