import { useCallback, useMemo, useState } from 'react'
import type { FileUIPart } from 'ai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { expandTemplate, parseSlashInput } from '@shared/slash-command'
import type { PermissionMode } from '@shared/policy'
import { useAgents, usePolicyMode, useConversations } from '../../model/queries'
import { useChatSession } from '../../model'
import { useChatUiStore } from '../../model/store'
import { useSlashCommands } from '../../model/slash/use-slash-commands'
import { usePluginMentions } from '../../model/conversation/use-plugin-mentions'
import {
  useSetPolicyMode,
  useSetConversationModel,
  useSetConversationAgent
} from '../../model/mutations'
import { ChatInput } from './chat-input'
import { ComposerPanel } from './composer-panel'
import { QueuedMessages } from './queued-messages'
import { ContextUsageBadge } from './context-usage-badge'
import { ModelSelector } from './model-selector'
import { selectLatestTodos } from './todo-panel-utils'
import { agentQueryFromInsertText, agentSlashCommands, resolveAgent } from './agent-slash'
import { useComposerModel } from './use-composer-model'
import { chatClient } from '@/platform/electron/chat-client'

export interface ComposerProps {
  chatId: string
}

export function Composer({ chatId }: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { session, state } = useChatSession(chatId)
  const draft = useChatUiStore((uiState) => uiState.draftByChatId[chatId] ?? '')
  const setDraft = useChatUiStore((uiState) => uiState.setDraft)
  const mode = usePolicyMode(chatId)
  const setMode = useSetPolicyMode()
  const setModel = useSetConversationModel()
  const setAgent = useSetConversationAgent()
  const conversations = useConversations()
  const agents = useAgents('main')
  const [isCompacting, setIsCompacting] = useState(false)

  const isStreaming = state.isStreaming
  const isCompactionRun = state.activeRunKind === 'compaction'
  const handleStop = useCallback(() => session.stop(), [session])

  const todos = useMemo(() => selectLatestTodos(state.messages), [state.messages])

  const activeConversation = useMemo(
    () => (conversations.data ?? []).find((c) => c.id === chatId) ?? null,
    [conversations.data, chatId]
  )

  const baseSlashCommands = useSlashCommands(activeConversation?.cwd ?? null)
  const pluginMentions = usePluginMentions()
  const slashCommands = useMemo(
    () => [...baseSlashCommands, ...agentSlashCommands(agents.data ?? [])],
    [baseSlashCommands, agents.data]
  )

  const {
    modelRef,
    effectiveReasoningEffort,
    handleSelectModel,
    handleReasoningEffortChange,
    subagentModelRef,
    handleSelectSubagentModel
  } = useComposerModel({ chatId, activeConversation })

  const handlePermissionModeChange = useCallback(
    (next: PermissionMode) => {
      setMode.mutate({ mode: next, chatId })
    },
    [setMode, chatId]
  )

  const handleCompact = useCallback(async () => {
    if (isCompacting) return
    if (isStreaming) {
      toast.info(t('chat.errors.compactDuringRun'))
      return
    }
    if (state.messages.length === 0) {
      toast.info(t('chat.errors.compactRequiresConversation'))
      return
    }
    try {
      setIsCompacting(true)
      const outcome = await chatClient.compact(chatId)
      await session.refresh()
      switch (outcome) {
        case 'compacted':
          toast.success(t('chat.composer.context.compactedToast'))
          break
        case 'not-needed':
          toast.info(t('chat.composer.context.noCompactNeeded'))
          break
        case 'aborted':
          toast.info(t('chat.composer.context.compactAborted'))
          break
        case 'stale':
          toast.info(t('chat.composer.context.compactStale'))
          break
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.errors.compact'))
    } finally {
      setIsCompacting(false)
    }
  }, [chatId, isCompacting, isStreaming, session, state.messages, t])

  const handleSubmit = useCallback(
    async (text: string, files?: FileUIPart[]) => {
      const trimmed = text.trim()
      if (!trimmed && (!files || files.length === 0)) return

      const parsed = parseSlashInput(trimmed)
      const command = parsed
        ? slashCommands.find((candidate) => candidate.name === parsed.name)
        : undefined

      if (parsed && command?.kind === 'action') {
        if (command.name === 'compact') await handleCompact()
        else if (command.name === 'goal') {
          try {
            const message = await session.goalCommand(parsed.args)
            toast.success(message)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : t('chat.errors.goalCommand'))
          }
        } else if (command.source === 'agent') {
          if (isStreaming) {
            toast.error(t('chat.errors.agentCommandDuringRun'))
            return
          }
          const query =
            command.name === 'agent'
              ? parsed.args.trim()
              : (agentQueryFromInsertText(command.insertText) ?? parsed.args.trim())
          if (!query) {
            toast.error(t('chat.errors.agentCommandMissing'))
            return
          }
          const target = resolveAgent(query, agents.data ?? [])
          if (!target) {
            toast.error(t('chat.errors.agentCommandUnknown', { agent: query }))
            return
          }
          if (target.id !== activeConversation?.agentId) {
            try {
              await setAgent.mutateAsync({ chatId, agentId: target.id })
            } catch {
              return
            }
          }
        }
        return
      }

      if (!modelRef) return
      if (activeConversation && activeConversation.modelRef !== modelRef) {
        try {
          await setModel.mutateAsync({ chatId: activeConversation.id, modelRef })
        } catch {
          return
        }
      }

      if (parsed && command) {
        if (command.kind === 'prompt' && command.template) {
          session.sendMessage({ text: expandTemplate(command.template, parsed.args) })
          return
        }

        if (command.kind === 'skill' && command.skillName) {
          const suffix = parsed.args.trim() ? ` ${parsed.args}` : ''
          session.sendMessage({ text: `Use the ${command.skillName} skill.${suffix}` })
          return
        }
      }

      session.sendMessage({ text: trimmed, ...(files && files.length > 0 ? { files } : {}) })
    },
    [
      activeConversation,
      chatId,
      handleCompact,
      agents.data,
      isStreaming,
      modelRef,
      session,
      setModel,
      setAgent,
      slashCommands,
      t
    ]
  )

  const compactionTriggerTokens = state.contextStatus?.compactionTriggerTokens
  const contextBadge = compactionTriggerTokens ? (
    <ContextUsageBadge
      contextUsed={state.contextStatus?.usedTokens}
      compactionTriggerTokens={compactionTriggerTokens}
      recentCompaction={state.recentCompaction ?? undefined}
    />
  ) : null

  const trailing = (
    <ModelSelector
      selectedId={modelRef}
      onSelect={handleSelectModel}
      reasoningEffort={effectiveReasoningEffort}
      onReasoningEffortChange={handleReasoningEffortChange}
      subagent={{ selectedId: subagentModelRef, onSelect: handleSelectSubagentModel }}
      disabled={isStreaming}
    />
  )

  return (
    <div className="flex w-full flex-col gap-1.5">
      <QueuedMessages
        items={state.queuedMessages}
        onRemove={session.removeQueued}
        onSteer={session.steer}
      />
      <div className="relative">
        <ComposerPanel goal={state.goal} todos={todos} onGoalCommand={session.goalCommand} />
        <ChatInput
          state={{
            isStreaming,
            permissionMode: mode.data ?? 'default',
            contextBadge,
            canSubmitOverride: Boolean(modelRef)
          }}
          actions={{
            onSubmit: handleSubmit,
            ...(isCompactionRun ? {} : { onSteer: session.steer, onQueue: session.enqueue }),
            onStop: handleStop,
            onPermissionModeChange: handlePermissionModeChange
          }}
          trailingSlot={trailing}
          slashCommands={slashCommands}
          workspaceRoot={activeConversation?.cwd ?? null}
          pluginMentions={pluginMentions}
          draft={draft}
          onDraftChange={(next) => setDraft(chatId, next)}
        />
      </div>
    </div>
  )
}
