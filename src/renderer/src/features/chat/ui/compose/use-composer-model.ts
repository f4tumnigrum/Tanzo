import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useSetConversationModel,
  useSetConversationReasoningEffort,
  useSetConversationSubagentModel
} from '../../model/mutations'
import { DEFAULT_REASONING_EFFORT } from '../../model/reasoning-effort'
import { useReasoningEffortControl } from '../../model/use-reasoning-effort'
import {
  findModelOption,
  getDefaultLanguageModel,
  useAvailableLanguageModels,
  type LanguageModelOption
} from '../../model/use-available-models'

export interface UseComposerModelResult {
  modelRef: string | null
  activeModel: LanguageModelOption | undefined
  reasoningEffort: string
  reasoningEffortOptions: string[] | null
  handleSelectModel: (nextModelRef: string) => void
  handleReasoningEffortChange: (next: string) => void
  subagentModelRef: string | null
  handleSelectSubagentModel: (nextModelRef: string) => void
}

export function useComposerModel({
  chatId,
  activeConversation
}: {
  chatId: string
  activeConversation: {
    id: string
    modelRef?: string | null
    subagentModelRef?: string | null
    reasoningEffort?: string | null
  } | null
}): UseComposerModelResult {
  const setModel = useSetConversationModel()
  const setSubagentModel = useSetConversationSubagentModel()
  const setReasoningEffort = useSetConversationReasoningEffort()
  const { models } = useAvailableLanguageModels()

  const defaultModelRef = useMemo(() => getDefaultLanguageModel(models)?.id ?? null, [models])

  const storedModelRef = activeConversation?.modelRef || null
  const storedModel = useMemo(
    () => findModelOption(models, storedModelRef),
    [models, storedModelRef]
  )
  const modelRef = storedModel?.id ?? defaultModelRef
  const activeModel = useMemo(() => findModelOption(models, modelRef), [models, modelRef])

  // Reasoning effort is a per-conversation setting (same scope as modelRef);
  // when unset the badge shows what the provider defaults would apply.
  const effortControl = useReasoningEffortControl(
    activeModel,
    activeConversation?.reasoningEffort ?? null
  )

  const defaultedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!activeConversation || !defaultModelRef) return
    if (storedModel) return
    const defaultKey = `${activeConversation.id}:${defaultModelRef}`
    if (defaultedFor.current === defaultKey) return
    defaultedFor.current = defaultKey
    setModel.mutate({ chatId: activeConversation.id, modelRef: defaultModelRef })
  }, [activeConversation, defaultModelRef, setModel, storedModel])

  const handleSelectModel = useCallback(
    (nextModelRef: string) => {
      setModel.mutate({ chatId, modelRef: nextModelRef })
    },
    [setModel, chatId]
  )

  const handleReasoningEffortChange = useCallback(
    (next: string) => {
      setReasoningEffort.mutate({
        chatId,
        effort: next === DEFAULT_REASONING_EFFORT ? '' : next
      })
    },
    [setReasoningEffort, chatId]
  )

  const storedSubagentModelRef = activeConversation?.subagentModelRef || null
  const subagentModelRef = useMemo(
    () => findModelOption(models, storedSubagentModelRef)?.id ?? null,
    [models, storedSubagentModelRef]
  )

  const handleSelectSubagentModel = useCallback(
    (nextModelRef: string) => {
      setSubagentModel.mutate({ chatId, modelRef: nextModelRef })
    },
    [setSubagentModel, chatId]
  )

  return {
    modelRef,
    activeModel,
    reasoningEffort: effortControl.effort,
    reasoningEffortOptions: effortControl.options,
    handleSelectModel,
    handleReasoningEffortChange,
    subagentModelRef,
    handleSelectSubagentModel
  }
}
