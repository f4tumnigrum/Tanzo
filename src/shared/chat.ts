import type { InferUIMessageChunk } from 'ai'
import type {
  AskQuestionAnswer,
  AskQuestionInput,
  QueuedMessage,
  TanzoDataParts,
  TanzoUIMessage
} from './agent-message'
import type {
  SubagentTask,
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalScope,
  SubagentTaskApprovalView
} from './subagent-task'

export type {
  SubagentTask,
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalScope,
  SubagentTaskApprovalView
} from './subagent-task'

export type AgentKind = 'main' | 'subagent'
export type ConversationParentRelation = 'fork' | 'subagent'

export interface AgentSummary {
  id: string
  name: string
  description: string
  kind: AgentKind
}

export interface WorkspaceSummary {
  id: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface ConversationSummary {
  id: string
  title: string
  agentId: string
  modelRef: string
  subagentModelRef: string
  workspaceId: string
  workspaceName?: string
  cwd: string
  parentConversationId: string | null
  parentRelation: ConversationParentRelation | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface NewConversationInput {
  agentId?: string
  title?: string
  modelRef?: string
  subagentModelRef?: string
  workspaceId?: string
  cwd?: string
  parentConversationId?: string
  parentRelation?: ConversationParentRelation
}

export interface ForkConversationInput {
  sourceChatId: string
  messageId: string
}

export interface EditMessageInput {
  chatId: string
  messageId: string
  text: string
}

export interface ForkConversationResult {
  conversation: ConversationSummary
}

/**
 * Maximum number of messages that can wait in a single conversation's dispatch
 * queue. When the queue is full, new enqueue requests are rejected (oldest
 * entries are preserved) so a burst of clicks cannot grow unbounded or amplify
 * disk writes.
 */
export const QUEUED_MESSAGE_LIMIT = 20

export const CHAT_CHANNELS = {
  submit: 'chat:submit',
  editMessage: 'chat:edit-message',
  respondApprovals: 'chat:respond-approvals',
  retryTurn: 'chat:retry-turn',
  lastRunOutcome: 'chat:last-run-outcome',
  cancel: 'chat:cancel',
  steer: 'chat:steer',
  enqueue: 'chat:enqueue',
  dequeue: 'chat:dequeue',
  listQueued: 'chat:list-queued',
  listRunning: 'chat:list-running',
  event: 'chat:event',
  runSnapshot: 'chat:run-snapshot',
  createConversation: 'chat:create-conversation',
  forkConversation: 'chat:fork-conversation',
  getConversation: 'chat:get-conversation',
  listConversations: 'chat:list-conversations',
  listWorkspaces: 'chat:list-workspaces',
  listMessages: 'chat:list-messages',
  deleteConversation: 'chat:delete-conversation',
  deleteWorkspace: 'chat:delete-workspace',
  setConversationModel: 'chat:set-conversation-model',
  setConversationTitle: 'chat:set-conversation-title',
  setConversationSubagentModel: 'chat:set-conversation-subagent-model',
  setConversationAgent: 'chat:set-conversation-agent',
  listAgents: 'chat:list-agents',
  compact: 'chat:compact',
  loadArchived: 'chat:load-archived',
  contextSnapshot: 'chat:context-snapshot',
  approveTask: 'chat:approve-task',
  pendingTaskApprovals: 'chat:pending-task-approvals',
  listTasks: 'chat:list-tasks',
  retryTask: 'chat:retry-task',
  cancelTask: 'chat:cancel-task',
  taskEvent: 'chat:task-event',
  answerQuestion: 'chat:answer-question'
} as const

export type ChatChannel = (typeof CHAT_CHANNELS)[keyof typeof CHAT_CHANNELS]

export const chatAnyEventChannel = (): string => CHAT_CHANNELS.event
export const chatEventChannel = (chatId: string): string => `${CHAT_CHANNELS.event}:${chatId}`
export const taskEventChannel = (rootChatId: string): string =>
  `${CHAT_CHANNELS.taskEvent}:${rootChatId}`

export type TaskEvent =
  | { type: 'tasks'; rootChatId: string; tasks: SubagentTask[] }
  | { type: 'approvals'; rootChatId: string; approvals: SubagentTaskApprovalView[] }

export type ChatRunStatus = 'running' | 'finished' | 'failed' | 'aborted'

export type ChatRunKind = 'chat' | 'compaction'

export type CompactionOutcome = 'compacted' | 'not-needed' | 'aborted' | 'stale'

export interface ChatRunError {
  code: string
  message: string
}

/** Persisted outcome of the most recent run, read back from the runs table. */
export interface ChatRunOutcomeError {
  /** 'stream-error' | 'aborted' | 'interrupted' (open for forward compat). */
  kind: string
  message?: string
  code?: string
  detail?: NonNullable<TanzoDataParts['telemetry']['error']>
}

export interface ChatRunOutcome {
  runId: string
  status: 'finished' | 'failed'
  finishedAt: number | null
  error?: ChatRunOutcomeError
}

export interface ChatRunFrame {
  kind: 'run-frame'
  chatId: string
  runId: string
  seq: number
  chunk: InferUIMessageChunk<TanzoUIMessage>
}

export interface ChatRunStateEvent {
  kind: 'run-state'
  chatId: string
  runId: string
  runKind: ChatRunKind
  status: ChatRunStatus
  error?: ChatRunError
}

export type ChatNotificationChunk = InferUIMessageChunk<TanzoUIMessage> & {
  type: `data-${string}`
}

export interface ChatNotificationEvent {
  kind: 'notification'
  chatId: string
  chunk: ChatNotificationChunk
}

export type ChatEvent = ChatRunFrame | ChatRunStateEvent | ChatNotificationEvent

export interface ChatRunSnapshot {
  chatId: string
  runId: string
  runKind: ChatRunKind
  status: 'running'
  baseMessages: TanzoUIMessage[]
  notifications: ChatNotificationChunk[]
  frames: ChatRunFrame[]
}

export type SubagentApprovalScope = SubagentTaskApprovalScope

export interface ChatApprovalResponse {
  approvalId: string
  approved: boolean
  reason?: string
  scope?: SubagentApprovalScope
}

export interface PendingQuestion {
  chatId: string
  questionId: string
  input: AskQuestionInput
}

export type QuestionReply =
  { declined?: false; answers: AskQuestionAnswer[] } | { declined: true; note?: string }

export interface ChatApi {
  submit(chatId: string, message: TanzoUIMessage): Promise<void>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  respondApprovals(chatId: string, responses: ChatApprovalResponse[]): Promise<{ started: boolean }>
  retryTurn(chatId: string): Promise<void>
  lastRunOutcome(chatId: string): Promise<ChatRunOutcome | null>
  cancel(chatId: string): Promise<void>
  steer(chatId: string, text: string): Promise<void>
  enqueue(chatId: string, text: string): Promise<void>
  removeQueued(chatId: string, id: string): Promise<void>
  listQueued(chatId: string): Promise<QueuedMessage[]>
  listRunning(): Promise<string[]>
  createConversation(input?: NewConversationInput): Promise<ConversationSummary>
  forkConversation(input: ForkConversationInput): Promise<ForkConversationResult>
  getConversation(chatId: string): Promise<ConversationSummary | null>
  listConversations(): Promise<ConversationSummary[]>
  listWorkspaces(): Promise<WorkspaceSummary[]>
  listMessages(chatId: string): Promise<TanzoUIMessage[]>
  deleteConversation(chatId: string): Promise<void>
  deleteWorkspace(workspaceId: string): Promise<void>
  setConversationModel(chatId: string, modelRef: string): Promise<ConversationSummary>
  setConversationTitle(chatId: string, title: string): Promise<ConversationSummary>
  setConversationSubagentModel(chatId: string, modelRef: string): Promise<ConversationSummary>
  setConversationAgent(chatId: string, agentId: string): Promise<ConversationSummary>
  listAgents(kind: AgentKind): Promise<AgentSummary[]>
  compact(chatId: string, options?: { instructions?: string }): Promise<CompactionOutcome>
  contextSnapshot(chatId: string): Promise<TanzoDataParts['context'] | null>
  loadArchived(chatId: string, summaryId: string): Promise<TanzoUIMessage[]>
  approveTask(rootChatId: string, response: SubagentTaskApprovalResponse): Promise<void>
  pendingTaskApprovals(rootChatId: string): Promise<SubagentTaskApprovalView[]>
  listTasks(rootChatId: string): Promise<SubagentTask[]>
  retryTask(rootChatId: string, taskId: string): Promise<void>
  cancelTask(rootChatId: string, taskId: string): Promise<void>
  answerQuestion(chatId: string, questionId: string, reply: QuestionReply): Promise<void>
  runSnapshot(chatId: string): Promise<ChatRunSnapshot | null>
  onEvent(chatId: string, callback: (event: ChatEvent) => void): () => void
  onAnyEvent(callback: (event: ChatEvent) => void): () => void
  onTaskEvent(rootChatId: string, callback: (event: TaskEvent) => void): () => void
}
