import { useCallback, useMemo, useState } from 'react'
import type { FileUIPart } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { PermissionMode } from '@shared/policy'
import { usePolicyMode, useSetPolicyMode } from '../../model'
import {
  findModelOption,
  getDefaultLanguageModel,
  useAvailableLanguageModels
} from '../../model/use-available-models'
import { useReasoningEffortControl } from '../../model/use-reasoning-effort'
import { ChatInput } from './chat-input'
import { ModelSelector } from './model-selector'
import { usePluginMentions } from '../../model/conversation/use-plugin-mentions'

export interface StartConversationDraft {
  message: TanzoUIMessage
  modelRef: string
  /** Conversation-scoped reasoning effort chosen before the chat exists. */
  reasoningEffort?: string
}

export interface StartComposerProps {
  workspaceRoot?: string | null
  onStart: (draft: StartConversationDraft) => Promise<void>
}

export function StartComposer({
  workspaceRoot = null,
  onStart
}: StartComposerProps): React.JSX.Element {
  const mode = usePolicyMode()
  const setMode = useSetPolicyMode()
  const pluginMentions = usePluginMentions()
  const { models } = useAvailableLanguageModels()
  const [selectedModelRef, setSelectedModelRef] = useState<string | null>(null)
  // Pre-conversation effort choice; '' means "untouched", so the badge shows
  // the provider schema's default. Resolved to a concrete value at start.
  const [selectedEffort, setSelectedEffort] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const defaultModel = useMemo(() => getDefaultLanguageModel(models), [models])
  const selectedModel = useMemo(
    () => findModelOption(models, selectedModelRef),
    [models, selectedModelRef]
  )
  const activeModel = selectedModel ?? defaultModel
  const modelRef = activeModel?.id ?? null
  const effortControl = useReasoningEffortControl(activeModel, selectedEffort)

  const handlePermissionModeChange = useCallback(
    (next: PermissionMode) => {
      setMode.mutate({ mode: next })
    },
    [setMode]
  )

  const handleSelectModel = useCallback((nextModelRef: string) => {
    setSelectedModelRef(nextModelRef)
    // Effort choices are provider-specific; reset when the model changes so the
    // new provider's default applies.
    setSelectedEffort('')
  }, [])

  const handleReasoningEffortChange = useCallback((next: string) => {
    setSelectedEffort(next)
  }, [])

  const handleSubmit = useCallback(
    async (text: string, files?: FileUIPart[]) => {
      const trimmed = text.trim()
      if ((!trimmed && (!files || files.length === 0)) || !modelRef || isSubmitting) return

      const parts: TanzoUIMessage['parts'] = []
      if (trimmed) parts.push({ type: 'text', text: trimmed })
      if (files) parts.push(...(files as TanzoUIMessage['parts']))

      // The badge always reflects a real provider choice (the schema default
      // when untouched); persist it so the new conversation starts explicit.
      const effort = effortControl.options ? effortControl.effort : undefined

      setIsSubmitting(true)
      try {
        await onStart({
          message: {
            id: crypto.randomUUID(),
            role: 'user',
            parts
          },
          modelRef,
          ...(effort ? { reasoningEffort: effort } : {})
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, modelRef, onStart, effortControl.options, effortControl.effort]
  )

  const trailing = (
    <ModelSelector
      selectedId={modelRef}
      onSelect={handleSelectModel}
      reasoningEffort={effortControl.effort}
      reasoningEffortOptions={effortControl.options}
      onReasoningEffortChange={handleReasoningEffortChange}
      disabled={isSubmitting}
    />
  )

  return (
    <ChatInput
      state={{
        isStreaming: false,
        permissionMode: mode.data ?? 'default',
        canSubmitOverride: Boolean(modelRef) && !isSubmitting
      }}
      actions={{
        onSubmit: handleSubmit,
        onPermissionModeChange: handlePermissionModeChange
      }}
      trailingSlot={trailing}
      workspaceRoot={workspaceRoot}
      pluginMentions={pluginMentions}
    />
  )
}
