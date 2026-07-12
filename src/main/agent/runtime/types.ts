import type { InferUIMessageChunk, ModelMessage, ToolSet } from 'ai'
import type {
  ChatApprovalResponse,
  CompactionOutcome,
  ForkConversationInput,
  ForkConversationResult
} from '@shared/chat'
import type {
  SteerTaskOutcome,
  SubagentTask,
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalView,
  SubagentTaskResult,
  SubagentTaskStatus
} from '@shared/subagent-task'
import type { QueuedMessage, TanzoDataParts, TanzoUIMessage } from '@shared/agent-message'
import type { AskQuestionAnswer } from '@shared/agent-message'
import type { GoalDecision, ThreadGoal } from '@shared/goal'
import type { PermissionMode } from '@shared/policy'
import type { ProviderService } from '../../provider/service'
import type { AgentDefinition, AgentIdentity } from '../agents/types'
import type { Logger } from '../logging'
import type { PolicyEngine } from '../policy/types'
import type { AgentStore } from '../store-types'

export interface ChunkSinkMeta {
  runId?: string
}

export type ChunkSink = (
  chatId: string,
  chunk: InferUIMessageChunk<TanzoUIMessage>,
  meta?: ChunkSinkMeta
) => void

export interface BuildToolsContext {
  def: AgentDefinition
  chatId: string
  depth: number
  mode: PermissionMode
  messages?: readonly TanzoUIMessage[]

  runId?: string
}

export type BuildTools = (context: BuildToolsContext) => Promise<ToolSet>

export interface HookLifecycle {
  takePendingContext?(chatId: string): string[]
  clearPendingContext?(chatId: string): void
  runUserPromptSubmit(input: {
    chatId: string
    prompt: string
  }): Promise<{ denied: boolean; denyReason?: string }>
  runPostToolUse(input: {
    chatId: string
    toolName: string
    toolInput: unknown
    toolResponse: unknown
    toolUseId: string
  }): Promise<{ stopped: boolean; stopReason?: string }>
  runSessionStart(input: {
    chatId: string
    source: 'startup' | 'resume' | 'clear' | 'compact'
  }): Promise<unknown>
  runStop(input: {
    chatId: string
    stopHookActive: boolean
    lastAssistantMessage: string | null
  }): Promise<{ stopped: boolean; stopReason?: string; feedback?: string[] }>
}

export type ChannelSink = (channel: string, payload: unknown) => void

export interface AgentRuntimeDeps {
  providerService: ProviderService
  buildTools: BuildTools
  policy: PolicyEngine
  store: AgentStore
  identity: AgentIdentity
  send: ChunkSink
  sendTo?: ChannelSink
  hooks?: HookLifecycle
}

export interface GoalRuntime {
  get(chatId: string): ThreadGoal | null
  evaluate(
    chatId: string,
    input: {
      isGoalContinuation: boolean
      worktreeChanged: boolean | null
      producedWorkToolCall: boolean
      turnTokens: number
      turnSeconds: number
      isPlanMode: boolean
      suppressContinuation: boolean
      outcomeEligible: boolean
    }
  ): GoalDecision
  markUsageLimited(chatId: string): void
}

export interface SpawnTaskRequest {
  parentChatId: string
  objective: string
  agentType: string
  dependsOn?: string[]
  signal?: AbortSignal
}

export type QuestionResponse = {
  chatId: string
  questionId: string
} & (
  | { declined?: false; answers: AskQuestionAnswer[] }
  | { declined: true; note?: string; answers?: never }
)

export interface AgentService {
  run(chatId: string, incoming: TanzoUIMessage[]): Promise<void>
  cancel(chatId: string): void
  steer(chatId: string, text: string): void
  startGoalContinuation(chatId: string): Promise<void>
  enqueue(chatId: string, text: string): void
  removeQueued(chatId: string, id: string): void
  listQueued(chatId: string): QueuedMessage[]
  isRunning(chatId: string): boolean
  listRunning(): string[]
  settleRuns(timeoutMs: number): Promise<boolean>
  deleteWorkspace(workspaceId: string): void
  deleteConversation(chatId: string): void
  clearMessages(chatId: string): void
  forkConversation(input: ForkConversationInput): Promise<ForkConversationResult>
  submitUserMessage(chatId: string, message: string): Promise<void>
  submitMessage(chatId: string, message: TanzoUIMessage): Promise<void>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  retryTurn(chatId: string): Promise<void>
  respondApprovals(chatId: string, responses: ChatApprovalResponse[]): Promise<{ started: boolean }>
  compact(chatId: string, options?: { instructions?: string }): Promise<CompactionOutcome>
  contextSnapshot(chatId: string): Promise<TanzoDataParts['context'] | null>
  spawnTask(input: SpawnTaskRequest): SubagentTask
  awaitTask(rootChatId: string, taskId: string, signal?: AbortSignal): Promise<SubagentTaskResult>
  getTask(rootChatId: string, taskId: string): SubagentTask | undefined
  listTasks(rootChatId: string, status?: SubagentTaskStatus): SubagentTask[]
  instructTask(rootChatId: string, taskId: string, instruction: string): Promise<SteerTaskOutcome>
  redefineTask(rootChatId: string, taskId: string, objective: string): Promise<SteerTaskOutcome>
  cancelTask(rootChatId: string, taskId: string): void
  retryTask(rootChatId: string, taskId: string): void
  addTaskNote(chatId: string, note: string): void
  waitForNoteTask(rootChatId: string, taskId: string, signal?: AbortSignal): Promise<void>
  respondTaskApproval(rootChatId: string, response: SubagentTaskApprovalResponse): Promise<void>
  listTaskApprovals(rootChatId: string): SubagentTaskApprovalView[]
  answerQuestion(input: QuestionResponse): Promise<void>
}

export type { Logger, ModelMessage }
