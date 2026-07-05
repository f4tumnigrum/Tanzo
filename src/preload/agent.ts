import {
  CHAT_CHANNELS,
  chatAnyEventChannel,
  chatEventChannel,
  taskEventChannel,
  type ChatApi,
  type ChatEvent,
  type TaskEvent
} from '@shared/chat'
import { POLICY_CHANNELS, type PolicyApi } from '@shared/policy'
import { GOAL_CHANNELS, type GoalApi } from '@shared/goal'
import { ACTIVITY_CHANNELS, type ActivityApi } from '@shared/activity'
import { GIT_CHANNELS, gitEventChannel, type GitApi, type GitChangedEvent } from '@shared/git'
import { CHANGE_SET_CHANNELS, type ChangeSetApi } from '@shared/change-set'
import { invoke, subscribe } from './invoke'

export const chatApi: ChatApi = {
  submit: invoke<ChatApi['submit']>(CHAT_CHANNELS.submit),
  editMessage: invoke<ChatApi['editMessage']>(CHAT_CHANNELS.editMessage),
  respondApprovals: invoke<ChatApi['respondApprovals']>(CHAT_CHANNELS.respondApprovals),
  retryTurn: invoke<ChatApi['retryTurn']>(CHAT_CHANNELS.retryTurn),
  lastRunOutcome: invoke<ChatApi['lastRunOutcome']>(CHAT_CHANNELS.lastRunOutcome),
  cancel: invoke<ChatApi['cancel']>(CHAT_CHANNELS.cancel),
  steer: invoke<ChatApi['steer']>(CHAT_CHANNELS.steer),
  enqueue: invoke<ChatApi['enqueue']>(CHAT_CHANNELS.enqueue),
  removeQueued: invoke<ChatApi['removeQueued']>(CHAT_CHANNELS.dequeue),
  listQueued: invoke<ChatApi['listQueued']>(CHAT_CHANNELS.listQueued),
  listRunning: invoke<ChatApi['listRunning']>(CHAT_CHANNELS.listRunning),
  createConversation: invoke<ChatApi['createConversation']>(CHAT_CHANNELS.createConversation),
  forkConversation: invoke<ChatApi['forkConversation']>(CHAT_CHANNELS.forkConversation),
  getConversation: invoke<ChatApi['getConversation']>(CHAT_CHANNELS.getConversation),
  listConversations: invoke<ChatApi['listConversations']>(CHAT_CHANNELS.listConversations),
  listWorkspaces: invoke<ChatApi['listWorkspaces']>(CHAT_CHANNELS.listWorkspaces),
  listMessages: invoke<ChatApi['listMessages']>(CHAT_CHANNELS.listMessages),
  deleteConversation: invoke<ChatApi['deleteConversation']>(CHAT_CHANNELS.deleteConversation),
  deleteWorkspace: invoke<ChatApi['deleteWorkspace']>(CHAT_CHANNELS.deleteWorkspace),
  setConversationModel: invoke<ChatApi['setConversationModel']>(CHAT_CHANNELS.setConversationModel),
  setConversationTitle: invoke<ChatApi['setConversationTitle']>(CHAT_CHANNELS.setConversationTitle),
  setConversationSubagentModel: invoke<ChatApi['setConversationSubagentModel']>(
    CHAT_CHANNELS.setConversationSubagentModel
  ),
  setConversationReasoningEffort: invoke<ChatApi['setConversationReasoningEffort']>(
    CHAT_CHANNELS.setConversationReasoningEffort
  ),
  setConversationAgent: invoke<ChatApi['setConversationAgent']>(CHAT_CHANNELS.setConversationAgent),
  setConversationPinned: invoke<ChatApi['setConversationPinned']>(
    CHAT_CHANNELS.setConversationPinned
  ),
  listAgents: invoke<ChatApi['listAgents']>(CHAT_CHANNELS.listAgents),
  compact: invoke<ChatApi['compact']>(CHAT_CHANNELS.compact),
  contextSnapshot: invoke<ChatApi['contextSnapshot']>(CHAT_CHANNELS.contextSnapshot),
  loadArchived: invoke<ChatApi['loadArchived']>(CHAT_CHANNELS.loadArchived),
  approveTask: invoke<ChatApi['approveTask']>(CHAT_CHANNELS.approveTask),
  pendingTaskApprovals: invoke<ChatApi['pendingTaskApprovals']>(CHAT_CHANNELS.pendingTaskApprovals),
  listTasks: invoke<ChatApi['listTasks']>(CHAT_CHANNELS.listTasks),
  retryTask: invoke<ChatApi['retryTask']>(CHAT_CHANNELS.retryTask),
  cancelTask: invoke<ChatApi['cancelTask']>(CHAT_CHANNELS.cancelTask),
  steerTask: invoke<ChatApi['steerTask']>(CHAT_CHANNELS.steerTask),
  answerQuestion: invoke<ChatApi['answerQuestion']>(CHAT_CHANNELS.answerQuestion),
  runSnapshot: invoke<ChatApi['runSnapshot']>(CHAT_CHANNELS.runSnapshot),
  onEvent: (chatId, callback) => subscribe<ChatEvent>(chatEventChannel(chatId), callback),
  onAnyEvent: (callback) => subscribe<ChatEvent>(chatAnyEventChannel(), callback),
  onTaskEvent: (rootChatId, callback) =>
    subscribe<TaskEvent>(taskEventChannel(rootChatId), callback)
}

export const policyApi: PolicyApi = {
  listRules: invoke<PolicyApi['listRules']>(POLICY_CHANNELS.listRules),
  saveRule: invoke<PolicyApi['saveRule']>(POLICY_CHANNELS.saveRule),
  deleteRule: invoke<PolicyApi['deleteRule']>(POLICY_CHANNELS.deleteRule),
  listDecisions: invoke<PolicyApi['listDecisions']>(POLICY_CHANNELS.listDecisions),
  revokeDecision: invoke<PolicyApi['revokeDecision']>(POLICY_CHANNELS.revokeDecision),
  getMode: invoke<PolicyApi['getMode']>(POLICY_CHANNELS.getMode),
  setMode: invoke<PolicyApi['setMode']>(POLICY_CHANNELS.setMode)
}

export const goalApi: GoalApi = {
  get: invoke<GoalApi['get']>(GOAL_CHANNELS.get),
  create: invoke<GoalApi['create']>(GOAL_CHANNELS.create),
  updateObjective: invoke<GoalApi['updateObjective']>(GOAL_CHANNELS.updateObjective),
  setStatus: invoke<GoalApi['setStatus']>(GOAL_CHANNELS.setStatus),
  clear: invoke<GoalApi['clear']>(GOAL_CHANNELS.clear)
}

export const activityApi: ActivityApi = {
  summary: invoke<ActivityApi['summary']>(ACTIVITY_CHANNELS.summary),
  trend: invoke<ActivityApi['trend']>(ACTIVITY_CHANNELS.trend),
  reliability: invoke<ActivityApi['reliability']>(ACTIVITY_CHANNELS.reliability),
  conversations: invoke<ActivityApi['conversations']>(ACTIVITY_CHANNELS.conversations),
  runs: invoke<ActivityApi['runs']>(ACTIVITY_CHANNELS.runs),
  runDetail: invoke<ActivityApi['runDetail']>(ACTIVITY_CHANNELS.runDetail)
}

export const gitApi: GitApi = {
  getOverview: invoke<GitApi['getOverview']>(GIT_CHANNELS.overview),
  getStatus: invoke<GitApi['getStatus']>(GIT_CHANNELS.status),
  getDiff: invoke<GitApi['getDiff']>(GIT_CHANNELS.diff),
  listHistory: invoke<GitApi['listHistory']>(GIT_CHANNELS.history),
  getCommit: invoke<GitApi['getCommit']>(GIT_CHANNELS.commitDetail),
  listBranches: invoke<GitApi['listBranches']>(GIT_CHANNELS.branches),
  listRemoteBranches: invoke<GitApi['listRemoteBranches']>(GIT_CHANNELS.remoteBranches),
  listRemotes: invoke<GitApi['listRemotes']>(GIT_CHANNELS.remotes),
  getUser: invoke<GitApi['getUser']>(GIT_CHANNELS.user),
  init: invoke<GitApi['init']>(GIT_CHANNELS.init),
  stage: invoke<GitApi['stage']>(GIT_CHANNELS.stage),
  restoreStaged: invoke<GitApi['restoreStaged']>(GIT_CHANNELS.restoreStaged),
  restoreWorktree: invoke<GitApi['restoreWorktree']>(GIT_CHANNELS.restoreWorktree),
  discard: invoke<GitApi['discard']>(GIT_CHANNELS.discard),
  commit: invoke<GitApi['commit']>(GIT_CHANNELS.commit),
  fetch: invoke<GitApi['fetch']>(GIT_CHANNELS.fetch),
  pull: invoke<GitApi['pull']>(GIT_CHANNELS.pull),
  push: invoke<GitApi['push']>(GIT_CHANNELS.push),
  checkout: invoke<GitApi['checkout']>(GIT_CHANNELS.checkout),
  checkoutRemoteBranch: invoke<GitApi['checkoutRemoteBranch']>(GIT_CHANNELS.checkoutRemote),
  createBranch: invoke<GitApi['createBranch']>(GIT_CHANNELS.createBranch),
  deleteBranch: invoke<GitApi['deleteBranch']>(GIT_CHANNELS.deleteBranch),
  addRemote: invoke<GitApi['addRemote']>(GIT_CHANNELS.addRemote),
  removeRemote: invoke<GitApi['removeRemote']>(GIT_CHANNELS.removeRemote),
  setUser: invoke<GitApi['setUser']>(GIT_CHANNELS.setUser),
  watch: invoke<GitApi['watch']>(GIT_CHANNELS.watch),
  unwatch: invoke<GitApi['unwatch']>(GIT_CHANNELS.unwatch),
  onChanged: (callback) => subscribe<GitChangedEvent>(gitEventChannel(), callback)
}

export const changeSetApi: ChangeSetApi = {
  getChangeSetFilePatch: invoke<ChangeSetApi['getChangeSetFilePatch']>(CHANGE_SET_CHANNELS.patch),
  applyChangeSet: invoke<ChangeSetApi['applyChangeSet']>(CHANGE_SET_CHANNELS.apply)
}

export type ChatPreloadApi = typeof chatApi
export type PolicyPreloadApi = typeof policyApi
