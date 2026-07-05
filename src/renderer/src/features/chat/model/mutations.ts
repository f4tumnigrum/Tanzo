import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type {
  ConversationSummary,
  ForkConversationInput,
  ForkConversationResult,
  NewConversationInput
} from '@shared/chat'
import type { NewPolicyRuleInput, PermissionMode } from '@shared/policy'
import { chatClient } from '@/platform/electron/chat-client'
import { policyClient } from '@/platform/electron/policy-client'
import { errorMessage } from '@/common/lib/error-utils'
import { chatKeys } from './query-keys'
import { discardChatSession } from './conversation/session-manager'

function invalidateChatCollections(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: chatKeys.conversations() })
  queryClient.invalidateQueries({ queryKey: chatKeys.workspaces() })
}

export function useCreateConversation() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input?: NewConversationInput) => chatClient.createConversation(input),
    onSuccess: () => invalidateChatCollections(queryClient),
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.startRun')))
  })
}

export function useForkConversation() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ForkConversationInput): Promise<ForkConversationResult> =>
      chatClient.forkConversation(input),
    onSuccess: () => {
      invalidateChatCollections(queryClient)
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.forkConversation')))
  })
}

export function useDeleteConversation() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (chatId: string) => chatClient.deleteConversation(chatId),
    onSuccess: (_result, chatId) => {
      // Kept-alive sessions must not outlive their conversation.
      discardChatSession(chatId)
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.filter((conversation) => conversation.id !== chatId) : list
      )
      invalidateChatCollections(queryClient)
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.deleteConversation')))
  })
}

export function useDeleteWorkspace() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: string) => chatClient.deleteWorkspace(workspaceId),
    onSuccess: (_result, workspaceId) => {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.filter((conversation) => conversation.workspaceId !== workspaceId) : list
      )
      invalidateChatCollections(queryClient)
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.deleteConversation')))
  })
}

export function useSetConversationTitle() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { chatId: string; title: string }) =>
      chatClient.setConversationTitle(input.chatId, input.title),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.map((c) => (c.id === updated.id ? updated : c)) : list
      )
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.renameConversation')))
  })
}

export function useSetConversationPinned() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { chatId: string; pinned: boolean }) =>
      chatClient.setConversationPinned(input.chatId, input.pinned),
    onSuccess: (updated) => {
      // Patch only pinnedAt: pinning does not touch updated_at, so the
      // response row may be staler than concurrently refreshed cache entries.
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list
          ? list.map((c) => (c.id === updated.id ? { ...c, pinnedAt: updated.pinnedAt } : c))
          : list
      )
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.pinConversation')))
  })
}

export function useSetPolicyMode() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ mode, chatId }: { mode: PermissionMode; chatId?: string }) =>
      policyClient.setMode(mode, chatId),
    onSuccess: (_result, { mode, chatId }) => {
      queryClient.setQueryData(chatKeys.policyMode(chatId), mode)
    },
    onError: (error) => toast.error(errorMessage(error, t('policy.notifications.modeChangeFailed')))
  })
}

export function useSavePolicyRule() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rule: NewPolicyRuleInput & { id?: string }) => policyClient.saveRule(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.policyRules() })
      toast.success(t('policy.notifications.ruleSaved'))
    },
    onError: (error) => toast.error(errorMessage(error, t('policy.notifications.ruleSaveFailed')))
  })
}

export function useRevokeDecision() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { toolName: string; inputFingerprint: string; scopeTargetId?: string }) =>
      policyClient.revokeDecision(input.toolName, input.inputFingerprint, input.scopeTargetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.policyDecisions() })
      toast.success(t('policy.notifications.decisionRevoked'))
    },
    onError: (error) =>
      toast.error(errorMessage(error, t('policy.notifications.decisionRevokeFailed')))
  })
}

export function useSetConversationModel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { chatId: string; modelRef: string }) =>
      chatClient.setConversationModel(input.chatId, input.modelRef),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.map((c) => (c.id === updated.id ? updated : c)) : list
      )
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.setModel')))
  })
}

export function useSetConversationSubagentModel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { chatId: string; modelRef: string }) =>
      chatClient.setConversationSubagentModel(input.chatId, input.modelRef),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.map((c) => (c.id === updated.id ? updated : c)) : list
      )
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.setModel')))
  })
}

export function useSetConversationAgent() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { chatId: string; agentId: string }) =>
      chatClient.setConversationAgent(input.chatId, input.agentId),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.map((c) => (c.id === updated.id ? updated : c)) : list
      )
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.setAgent')))
  })
}

export function useSetConversationReasoningEffort() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { chatId: string; effort: string }) =>
      chatClient.setConversationReasoningEffort(input.chatId, input.effort),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations(), (list) =>
        list ? list.map((c) => (c.id === updated.id ? updated : c)) : list
      )
    },
    onError: (error) => toast.error(errorMessage(error, t('chat.errors.setReasoningEffort')))
  })
}
