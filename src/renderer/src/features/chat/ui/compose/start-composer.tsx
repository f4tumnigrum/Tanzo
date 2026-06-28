import { useCallback, useMemo, useState } from 'react'
import type { FileUIPart } from 'ai'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { PermissionMode } from '@shared/policy'
import { usePolicyMode, useSetPolicyMode, useSaveLanguageDefaults } from '../../model'
import {
  findModelOption,
  getDefaultLanguageModel,
  useAvailableLanguageModels
} from '../../model/use-available-models'
import {
  providerDefaultsWithReasoningEffort,
  reasoningEffortFromDefaults,
  type ReasoningEffort
} from '../../model/reasoning-effort'
import { ChatInput } from './chat-input'
import { ModelSelector } from './model-selector'
import { usePluginMentions } from '../../model/conversation/use-plugin-mentions'

export interface StartConversationDraft {
  message: TanzoUIMessage
  modelRef: string
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
  const saveLanguageDefaults = useSaveLanguageDefaults()
  const { models } = useAvailableLanguageModels()
  const [selectedModelRef, setSelectedModelRef] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const defaultModel = useMemo(() => getDefaultLanguageModel(models), [models])
  const selectedModel = useMemo(
    () => findModelOption(models, selectedModelRef),
    [models, selectedModelRef]
  )
  const activeModel = selectedModel ?? defaultModel
  const modelRef = activeModel?.id ?? null
  const reasoningEffort: ReasoningEffort = activeModel
    ? reasoningEffortFromDefaults(activeModel.providerId, activeModel.providerDefaults)
    : 'default'

  const handlePermissionModeChange = useCallback(
    (next: PermissionMode) => {
      setMode.mutate({ mode: next })
    },
    [setMode]
  )

  const handleReasoningEffortChange = useCallback(
    (next: ReasoningEffort) => {
      if (!activeModel) return
      saveLanguageDefaults.mutate({
        providerId: activeModel.providerId,
        defaults: providerDefaultsWithReasoningEffort(
          activeModel.providerId,
          activeModel.providerDefaults,
          next
        )
      })
    },
    [activeModel, saveLanguageDefaults]
  )

  const handleSubmit = useCallback(
    async (text: string, files?: FileUIPart[]) => {
      const trimmed = text.trim()
      if ((!trimmed && (!files || files.length === 0)) || !modelRef || isSubmitting) return

      const parts: TanzoUIMessage['parts'] = []
      if (trimmed) parts.push({ type: 'text', text: trimmed })
      if (files) parts.push(...(files as TanzoUIMessage['parts']))

      setIsSubmitting(true)
      try {
        await onStart({
          message: {
            id: crypto.randomUUID(),
            role: 'user',
            parts
          },
          modelRef
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, modelRef, onStart]
  )

  const trailing = (
    <ModelSelector
      selectedId={modelRef}
      onSelect={setSelectedModelRef}
      reasoningEffort={reasoningEffort}
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
