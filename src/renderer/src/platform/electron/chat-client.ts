import type {
  AgentKind,
  AgentSummary,
  ChatApi,
  ChatApprovalResponse,
  ChatEvent,
  ChatRunOutcome,
  ChatRunSnapshot,
  CompactionOutcome,
  ConversationSummary,
  ForkConversationInput,
  ForkConversationResult,
  NewConversationInput,
  QuestionReply,
  TaskEvent,
  WorkspaceSummary
} from '@shared/chat'
import type {
  SteerTaskOutcome,
  SubagentTask,
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalView
} from '@shared/subagent-task'
import type { QueuedMessage, TanzoDataParts, TanzoUIMessage } from '@shared/agent-message'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

export function requireChatApi(): ChatApi {
  const chatApi = window.electron?.chat
  if (!chatApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_CHAT_API_UNAVAILABLE',
      'Electron chat API is not available'
    )
  }
  return withDecodedIpcErrors(chatApi)
}

export const chatClient = {
  submit(chatId: string, message: TanzoUIMessage): Promise<void> {
    return requireChatApi().submit(chatId, message)
  },
  editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    return requireChatApi().editMessage(chatId, messageId, text)
  },
  respondApprovals(
    chatId: string,
    responses: ChatApprovalResponse[]
  ): Promise<{ started: boolean }> {
    return requireChatApi().respondApprovals(chatId, responses)
  },
  retryTurn(chatId: string): Promise<void> {
    return requireChatApi().retryTurn(chatId)
  },
  lastRunOutcome(chatId: string): Promise<ChatRunOutcome | null> {
    return requireChatApi().lastRunOutcome(chatId)
  },
  cancel(chatId: string): Promise<void> {
    return requireChatApi().cancel(chatId)
  },
  steer(chatId: string, text: string): Promise<void> {
    return requireChatApi().steer(chatId, text)
  },
  enqueue(chatId: string, text: string): Promise<void> {
    return requireChatApi().enqueue(chatId, text)
  },
  removeQueued(chatId: string, id: string): Promise<void> {
    return requireChatApi().removeQueued(chatId, id)
  },
  listQueued(chatId: string): Promise<QueuedMessage[]> {
    return requireChatApi()
      .listQueued(chatId)
      .then((items) => [...items])
  },
  createConversation(input?: NewConversationInput): Promise<ConversationSummary> {
    return requireChatApi().createConversation(input)
  },
  forkConversation(input: ForkConversationInput): Promise<ForkConversationResult> {
    return requireChatApi().forkConversation(input)
  },
  getConversation(chatId: string): Promise<ConversationSummary | null> {
    return requireChatApi().getConversation(chatId)
  },
  listConversations(): Promise<ConversationSummary[]> {
    return requireChatApi()
      .listConversations()
      .then((conversations) => [...conversations])
  },
  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return requireChatApi()
      .listWorkspaces()
      .then((workspaces) => [...workspaces])
  },
  listMessages(chatId: string): Promise<TanzoUIMessage[]> {
    return requireChatApi().listMessages(chatId)
  },
  compact(chatId: string, options?: { instructions?: string }): Promise<CompactionOutcome> {
    return requireChatApi().compact(chatId, options)
  },
  contextSnapshot(chatId: string): Promise<TanzoDataParts['context'] | null> {
    return requireChatApi().contextSnapshot(chatId)
  },
  loadArchived(chatId: string, summaryId: string): Promise<TanzoUIMessage[]> {
    return requireChatApi()
      .loadArchived(chatId, summaryId)
      .then((messages) => [...messages])
  },
  deleteConversation(chatId: string): Promise<void> {
    return requireChatApi().deleteConversation(chatId)
  },
  deleteWorkspace(workspaceId: string): Promise<void> {
    return requireChatApi().deleteWorkspace(workspaceId)
  },
  setConversationModel(chatId: string, modelRef: string): Promise<ConversationSummary> {
    return requireChatApi().setConversationModel(chatId, modelRef)
  },
  setConversationTitle(chatId: string, title: string): Promise<ConversationSummary> {
    return requireChatApi().setConversationTitle(chatId, title)
  },
  setConversationSubagentModel(chatId: string, modelRef: string): Promise<ConversationSummary> {
    return requireChatApi().setConversationSubagentModel(chatId, modelRef)
  },
  setConversationReasoningEffort(chatId: string, effort: string): Promise<ConversationSummary> {
    return requireChatApi().setConversationReasoningEffort(chatId, effort)
  },
  setConversationAgent(chatId: string, agentId: string): Promise<ConversationSummary> {
    return requireChatApi().setConversationAgent(chatId, agentId)
  },
  setConversationPinned(chatId: string, pinned: boolean): Promise<ConversationSummary> {
    return requireChatApi().setConversationPinned(chatId, pinned)
  },
  listAgents(kind: AgentKind): Promise<AgentSummary[]> {
    return requireChatApi()
      .listAgents(kind)
      .then((agents) => [...agents])
  },
  listRunning(): Promise<string[]> {
    return requireChatApi()
      .listRunning()
      .then((ids) => [...ids])
  },
  runSnapshot(chatId: string): Promise<ChatRunSnapshot | null> {
    return requireChatApi().runSnapshot(chatId)
  },
  pendingTaskApprovals(rootChatId: string): Promise<SubagentTaskApprovalView[]> {
    return requireChatApi()
      .pendingTaskApprovals(rootChatId)
      .then((list) => [...list])
  },
  listTasks(rootChatId: string): Promise<SubagentTask[]> {
    return requireChatApi()
      .listTasks(rootChatId)
      .then((list) => [...list])
  },
  answerQuestion(chatId: string, questionId: string, reply: QuestionReply): Promise<void> {
    return requireChatApi().answerQuestion(chatId, questionId, reply)
  },
  approveTask(rootChatId: string, response: SubagentTaskApprovalResponse): Promise<void> {
    return requireChatApi().approveTask(rootChatId, response)
  },
  retryTask(rootChatId: string, taskId: string): Promise<void> {
    return requireChatApi().retryTask(rootChatId, taskId)
  },
  cancelTask(rootChatId: string, taskId: string): Promise<void> {
    return requireChatApi().cancelTask(rootChatId, taskId)
  },
  steerTask(rootChatId: string, taskId: string, instruction: string): Promise<SteerTaskOutcome> {
    return requireChatApi().steerTask(rootChatId, taskId, instruction)
  },
  onEvent(chatId: string, callback: (event: ChatEvent) => void): () => void {
    return requireChatApi().onEvent(chatId, callback)
  },
  onAnyEvent(callback: (event: ChatEvent) => void): () => void {
    return requireChatApi().onAnyEvent(callback)
  },
  onTaskEvent(rootChatId: string, callback: (event: TaskEvent) => void): () => void {
    return requireChatApi().onTaskEvent(rootChatId, callback)
  }
}
