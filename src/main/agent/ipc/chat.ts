import { z } from 'zod'
import { CHAT_CHANNELS } from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import { toAgentSummary } from '../agents'
import { agentKindSchema, approvalScopeSchema, chatIdSchema } from './schemas'
import type { AgentIpcDeps, IpcRegistration } from './types'

const uiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['system', 'user', 'assistant']),
    parts: z.array(z.unknown())
  })
  .loose()

const userMessageSchema = uiMessageSchema
  .extend({
    role: z.literal('user'),
    parts: z.array(z.unknown()).min(1)
  })
  .loose()

const approvalResponsesSchema = z
  .array(
    z
      .object({
        approvalId: z.string().min(1),
        approved: z.boolean(),
        reason: z.string().optional(),
        scope: approvalScopeSchema.optional()
      })
      .strict()
  )
  .min(1)
  .max(20)

const newConversationSchema = z
  .object({
    agentId: z.string().optional(),
    title: z.string().optional(),
    modelRef: z.string().optional(),
    subagentModelRef: z.string().optional(),
    reasoningEffort: z.string().max(64).optional(),
    workspaceId: z.string().optional(),
    cwd: z.string().optional(),
    parentConversationId: z.string().optional(),
    parentRelation: z.enum(['fork', 'subagent']).optional()
  })
  .optional()

const forkConversationSchema = z.object({
  sourceChatId: chatIdSchema,
  messageId: z.string().trim().min(1)
})

const compactOptionsSchema = z
  .object({
    instructions: z.string().trim().optional()
  })
  .optional()
const messageTextSchema = z.string().trim().min(1)

const questionAnswerSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['single_select', 'multi_select', 'rank_priorities']),
    values: z.array(z.string().min(1)).min(1).max(16),
    labels: z.array(z.string()).optional(),
    custom: z.boolean()
  })
  .strict()

const questionReplySchema = z.union([
  z.object({ answers: z.array(questionAnswerSchema).min(1).max(3) }).strict(),
  z.object({ declined: z.literal(true), note: z.string().min(1).max(2000).optional() }).strict()
])

const taskApprovalResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional(),
    scope: approvalScopeSchema.optional(),
    suggestion: z
      .object({
        kind: z.enum(['retry', 'amend', 'skip', 'abort']),
        detail: z.string().optional()
      })
      .optional()
  })
  .strict()

export function chatHandlers(deps: AgentIpcDeps): IpcRegistration[] {
  return [
    [
      CHAT_CHANNELS.submit,
      (chatId, message) =>
        deps.service.submitMessage(
          chatIdSchema.parse(chatId),
          userMessageSchema.parse(message) as TanzoUIMessage
        )
    ],
    [
      CHAT_CHANNELS.editMessage,
      (chatId, messageId, text) =>
        deps.service.editMessage(
          chatIdSchema.parse(chatId),
          z.string().trim().min(1).parse(messageId),
          messageTextSchema.parse(text)
        )
    ],
    [
      CHAT_CHANNELS.respondApprovals,
      (chatId, responses) =>
        deps.service.respondApprovals(
          chatIdSchema.parse(chatId),
          approvalResponsesSchema.parse(responses)
        )
    ],
    [CHAT_CHANNELS.retryTurn, (chatId) => deps.service.retryTurn(chatIdSchema.parse(chatId))],
    [
      CHAT_CHANNELS.lastRunOutcome,
      (chatId) => deps.store.getLatestRunOutcome(chatIdSchema.parse(chatId))
    ],
    [CHAT_CHANNELS.cancel, (chatId) => deps.service.cancel(chatIdSchema.parse(chatId))],
    [
      CHAT_CHANNELS.steer,
      (chatId, text) =>
        deps.service.steer(chatIdSchema.parse(chatId), messageTextSchema.parse(text))
    ],
    [
      CHAT_CHANNELS.enqueue,
      (chatId, text) =>
        deps.service.enqueue(chatIdSchema.parse(chatId), messageTextSchema.parse(text))
    ],
    [
      CHAT_CHANNELS.dequeue,
      (chatId, id) =>
        deps.service.removeQueued(chatIdSchema.parse(chatId), messageTextSchema.parse(id))
    ],
    [CHAT_CHANNELS.listQueued, (chatId) => deps.service.listQueued(chatIdSchema.parse(chatId))],
    [CHAT_CHANNELS.listRunning, () => deps.service.listRunning()],
    [CHAT_CHANNELS.runSnapshot, (chatId) => deps.streams.snapshot(chatIdSchema.parse(chatId))],
    [
      CHAT_CHANNELS.createConversation,
      (input) => deps.store.createConversation(newConversationSchema.parse(input) ?? {})
    ],
    [
      CHAT_CHANNELS.forkConversation,
      (input) => deps.service.forkConversation(forkConversationSchema.parse(input))
    ],
    [
      CHAT_CHANNELS.getConversation,
      (chatId) => deps.store.getConversation(chatIdSchema.parse(chatId)) ?? null
    ],
    [CHAT_CHANNELS.listConversations, () => deps.store.listConversations()],
    [CHAT_CHANNELS.listWorkspaces, () => deps.store.listWorkspaces()],
    [CHAT_CHANNELS.listMessages, (chatId) => deps.store.loadDisplay(chatIdSchema.parse(chatId))],
    [
      CHAT_CHANNELS.deleteConversation,
      (chatId) => deps.service.deleteConversation(chatIdSchema.parse(chatId))
    ],
    [
      CHAT_CHANNELS.deleteWorkspace,
      (workspaceId) => deps.service.deleteWorkspace(chatIdSchema.parse(workspaceId))
    ],
    [
      CHAT_CHANNELS.setConversationModel,
      (chatId, modelRef) =>
        deps.store.setConversationModel(
          chatIdSchema.parse(chatId),
          z.string().trim().parse(modelRef)
        )
    ],
    [
      CHAT_CHANNELS.setConversationTitle,
      (chatId, title) =>
        deps.store.setConversationTitle(
          chatIdSchema.parse(chatId),
          z.string().trim().min(1).max(200).parse(title)
        )
    ],
    [
      CHAT_CHANNELS.setConversationSubagentModel,
      (chatId, modelRef) =>
        deps.store.setConversationSubagentModel(
          chatIdSchema.parse(chatId),
          z.string().trim().parse(modelRef)
        )
    ],
    [
      CHAT_CHANNELS.setConversationReasoningEffort,
      (chatId, effort) =>
        deps.store.setConversationReasoningEffort(
          chatIdSchema.parse(chatId),
          z.string().trim().max(64).parse(effort)
        )
    ],
    [
      CHAT_CHANNELS.setConversationAgent,
      (chatId, agentId) =>
        deps.store.setConversationAgent(
          chatIdSchema.parse(chatId),
          z.string().trim().min(1).parse(agentId)
        )
    ],
    [
      CHAT_CHANNELS.setConversationPinned,
      (chatId, pinned) =>
        deps.store.setConversationPinned(chatIdSchema.parse(chatId), z.boolean().parse(pinned))
    ],
    [
      CHAT_CHANNELS.listAgents,
      (kind) => deps.identity.listAgents(agentKindSchema.parse(kind)).map(toAgentSummary)
    ],
    [
      CHAT_CHANNELS.compact,
      (chatId, options) =>
        deps.service.compact(
          chatIdSchema.parse(chatId),
          compactOptionsSchema.parse(options) ?? undefined
        )
    ],
    [
      CHAT_CHANNELS.contextSnapshot,
      (chatId) => deps.service.contextSnapshot(chatIdSchema.parse(chatId))
    ],
    [
      CHAT_CHANNELS.loadArchived,
      (chatId, summaryId) =>
        deps.store.loadArchived(chatIdSchema.parse(chatId), z.string().min(1).parse(summaryId))
    ],
    [
      CHAT_CHANNELS.approveTask,
      (rootChatId, response) =>
        deps.service.respondTaskApproval(
          chatIdSchema.parse(rootChatId),
          taskApprovalResponseSchema.parse(response)
        )
    ],
    [
      CHAT_CHANNELS.pendingTaskApprovals,
      (rootChatId) => deps.service.listTaskApprovals(chatIdSchema.parse(rootChatId))
    ],
    [
      CHAT_CHANNELS.listTasks,
      (rootChatId) => deps.service.listTasks(chatIdSchema.parse(rootChatId))
    ],
    [
      CHAT_CHANNELS.retryTask,
      (rootChatId, taskId) =>
        deps.service.retryTask(chatIdSchema.parse(rootChatId), z.string().min(1).parse(taskId))
    ],
    [
      CHAT_CHANNELS.cancelTask,
      (rootChatId, taskId) =>
        deps.service.cancelTask(chatIdSchema.parse(rootChatId), z.string().min(1).parse(taskId))
    ],
    [
      CHAT_CHANNELS.steerTask,
      (rootChatId, taskId, instruction) =>
        deps.service.instructTask(
          chatIdSchema.parse(rootChatId),
          z.string().min(1).parse(taskId),
          z.string().min(1).parse(instruction)
        )
    ],
    [
      CHAT_CHANNELS.answerQuestion,
      (chatId, questionId, reply) => {
        const parsed = questionReplySchema.parse(reply)
        return deps.service.answerQuestion({
          chatId: chatIdSchema.parse(chatId),
          questionId: z.string().min(1).parse(questionId),
          ...parsed
        })
      }
    ]
  ]
}
