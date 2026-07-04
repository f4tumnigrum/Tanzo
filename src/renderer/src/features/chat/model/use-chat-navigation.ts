import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { toast } from 'sonner'
import type { ConversationSummary } from '@shared/chat'
import { systemClient } from '@/platform/electron/system-client'
import { chatClient } from '@/platform/electron/chat-client'
import { errorMessage } from '@/common/lib/error-utils'
import { useChatUiStore } from './store'
import { useConversations, useWorkspaces } from './queries'
import {
  useCreateConversation,
  useDeleteConversation,
  useDeleteWorkspace,
  useForkConversation,
  useSetConversationTitle
} from './mutations'
import { useRunningConversations } from './use-running-conversations'
import { workspaceActions, workspaceStore, type WorkspaceRecord } from './workspace-store'
import { buildSidebarModel, deriveWorkspacesFromConversations } from './sidebar-model'
import type { StartConversationDraft } from '../ui/compose/start-composer'

export interface ChatNavigation {
  activeChatId: string | null
  activeConversation: ConversationSummary | null
  currentWorkspace: WorkspaceRecord | null
  defaultWorkspace: WorkspaceRecord | null
  sidebarModel: ReturnType<typeof buildSidebarModel>
  handleSelectConversation: (chatId: string) => void
  handleNewConversation: () => Promise<void>
  handleStartConversation: (draft: StartConversationDraft) => Promise<void>
  handleWorkspaceConversationCreate: (workspaceId: string) => Promise<void>
  handleToggleWorkspaceExpanded: (workspaceId: string) => void
  handleDelete: (chatId: string) => void
  handleRename: (chatId: string, title: string) => void
  handleForkMessage: (messageId: string) => Promise<void>
  handleWorkspaceRemove: (workspaceId: string) => void
  handlePickWorkspace: () => Promise<void>
}

export function useChatNavigation(): ChatNavigation {
  const { t } = useTranslation()
  const activeChatId = useChatUiStore((state) => state.activeChatId)
  const setActiveChatId = useChatUiStore((state) => state.setActiveChatId)
  const currentWorkspaceId = useStore(workspaceStore, (state) => state.currentId)
  const expandedById = useStore(workspaceStore, (state) => state.expandedById)
  const conversations = useConversations()
  const workspaceQuery = useWorkspaces()
  const createConversation = useCreateConversation()
  const deleteConversation = useDeleteConversation()
  const deleteWorkspace = useDeleteWorkspace()
  const forkConversation = useForkConversation()
  const renameConversation = useSetConversationTitle()
  const conversationList = useMemo(() => conversations.data ?? [], [conversations.data])
  const workspaceList = useMemo(() => workspaceQuery.data ?? [], [workspaceQuery.data])
  const workspaces = useMemo(
    () => deriveWorkspacesFromConversations(conversationList, expandedById, workspaceList),
    [conversationList, expandedById, workspaceList]
  )

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId]
  )
  const defaultWorkspace = currentWorkspace ?? workspaces[0] ?? null

  useEffect(() => {
    workspaceActions.prune(new Set(workspaces.map((workspace) => workspace.id)))
  }, [workspaces])

  useEffect(() => {
    void window.electron?.pet?.setActiveChatId(activeChatId)
  }, [activeChatId])

  useEffect(() => {
    const activeConversation = conversationList.find(
      (conversation) => conversation.id === activeChatId
    )
    if (!activeConversation) return
    workspaceActions.setCurrent(activeConversation.workspaceId)
  }, [conversationList, activeChatId])

  const createConversationInWorkspace = useCallback(
    async (workspace: WorkspaceRecord) => {
      const conversation = await createConversation.mutateAsync({
        workspaceId: workspace.id,
        cwd: workspace.cwd
      })
      workspaceActions.setCurrent(conversation.workspaceId)
      setActiveChatId(conversation.id)
      return conversation
    },
    [createConversation, setActiveChatId]
  )

  const handlePickWorkspace = useCallback(async () => {
    const picked = await systemClient.pickDirectory({
      title: t('chat.workspace.pickerTitle'),
      ...(currentWorkspace?.cwd ? { defaultPath: currentWorkspace.cwd } : {})
    })
    if (!picked) return
    const conversation = await createConversation.mutateAsync({ cwd: picked })
    workspaceActions.setCurrent(conversation.workspaceId)
    setActiveChatId(conversation.id)
  }, [t, currentWorkspace, createConversation, setActiveChatId])

  const runningChatIds = useRunningConversations()

  const sidebarModel = useMemo(
    () =>
      buildSidebarModel({
        conversations: conversationList,
        currentWorkspaceId,
        expandedById,
        runningChatIds,
        workspaces,
        hydrated: conversations.isSuccess && workspaceQuery.isSuccess
      }),
    [
      conversationList,
      conversations.isSuccess,
      workspaceQuery.isSuccess,
      currentWorkspaceId,
      expandedById,
      runningChatIds,
      workspaces
    ]
  )

  const handleSelectConversation = useCallback(
    (chatId: string) => {
      const conversation = conversationList.find((candidate) => candidate.id === chatId)
      if (conversation) workspaceActions.setCurrent(conversation.workspaceId)
      setActiveChatId(chatId)
    },
    [conversationList, setActiveChatId]
  )

  const handleNewConversation = useCallback(async () => {
    if (!defaultWorkspace) {
      await handlePickWorkspace()
      return
    }
    await createConversationInWorkspace(defaultWorkspace)
  }, [defaultWorkspace, handlePickWorkspace, createConversationInWorkspace])

  const handleStartConversation = useCallback(
    async ({ message, modelRef }: StartConversationDraft) => {
      let cwd = defaultWorkspace?.cwd ?? null
      const workspaceId = defaultWorkspace?.id ?? null

      if (!cwd) {
        const picked = await systemClient.pickDirectory({ title: t('chat.workspace.pickerTitle') })
        if (!picked) return
        cwd = picked
      }

      const conversation = await createConversation.mutateAsync({
        modelRef,
        cwd,
        ...(workspaceId ? { workspaceId } : {})
      })
      workspaceActions.setCurrent(conversation.workspaceId)
      setActiveChatId(conversation.id)
      void chatClient
        .submit(conversation.id, message)
        .catch((error) => toast.error(errorMessage(error, t('chat.errors.startRun'))))
    },
    [defaultWorkspace, setActiveChatId, createConversation, t]
  )

  const handleWorkspaceConversationCreate = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
      if (!workspace) return
      workspaceActions.setCurrent(workspace.id)
      await createConversationInWorkspace(workspace)
    },
    [workspaces, createConversationInWorkspace]
  )

  const handleToggleWorkspaceExpanded = useCallback((workspaceId: string) => {
    workspaceActions.toggleExpanded(workspaceId)
  }, [])

  const handleDelete = useCallback(
    (chatId: string) => {
      const removedIds = new Set<string>([chatId])
      for (const conversation of conversationList) {
        if (conversation.parentConversationId === chatId) removedIds.add(conversation.id)
      }
      const deletingActive = activeChatId !== null && removedIds.has(activeChatId)
      const nextActive = deletingActive
        ? (conversationList
            .filter(
              (conversation) =>
                !removedIds.has(conversation.id) && conversation.parentRelation !== 'subagent'
            )
            .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null)
        : null

      deleteConversation.mutate(chatId, {
        onSuccess: () => {
          if (!deletingActive) return
          if (nextActive) {
            workspaceActions.setCurrent(nextActive.workspaceId)
            setActiveChatId(nextActive.id)
          } else {
            setActiveChatId(null)
          }
        }
      })
    },
    [conversationList, deleteConversation, activeChatId, setActiveChatId]
  )

  const handleRename = useCallback(
    (chatId: string, title: string) => {
      renameConversation.mutate({ chatId, title })
    },
    [renameConversation]
  )

  const handleForkMessage = useCallback(
    async (messageId: string) => {
      if (!activeChatId) return
      let result: Awaited<ReturnType<typeof forkConversation.mutateAsync>>
      try {
        result = await forkConversation.mutateAsync({
          sourceChatId: activeChatId,
          messageId
        })
      } catch {
        // The mutation's onError already surfaced a toast; swallowing here
        // prevents an unhandled rejection from the fork button.
        return
      }
      workspaceActions.setCurrent(result.conversation.workspaceId)
      setActiveChatId(result.conversation.id)
    },
    [activeChatId, forkConversation, setActiveChatId]
  )

  const handleWorkspaceRemove = useCallback(
    (workspaceId: string) => {
      deleteWorkspace.mutate(workspaceId)
      if (
        conversationList.some(
          (conversation) =>
            conversation.id === activeChatId && conversation.workspaceId === workspaceId
        )
      ) {
        setActiveChatId(null)
        workspaceActions.setCurrent(null)
      }
    },
    [conversationList, deleteWorkspace, activeChatId, setActiveChatId]
  )

  const activeConversation = useMemo(
    () => conversationList.find((conversation) => conversation.id === activeChatId) ?? null,
    [conversationList, activeChatId]
  )

  return {
    activeChatId,
    activeConversation,
    currentWorkspace,
    defaultWorkspace,
    sidebarModel,
    handleSelectConversation,
    handleNewConversation,
    handleStartConversation,
    handleWorkspaceConversationCreate,
    handleToggleWorkspaceExpanded,
    handleDelete,
    handleRename,
    handleForkMessage,
    handleWorkspaceRemove,
    handlePickWorkspace
  }
}
