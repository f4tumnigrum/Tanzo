import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SubagentTask } from '@shared/subagent-task'

interface ChatUiState {
  activeChatId: string | null
  draftByChatId: Record<string, string>
  disclosureById: Record<string, boolean>
  /** The sub-agent task whose read-only transcript is being viewed full-screen,
   *  or null when viewing the main conversation. */
  viewedSubagentTask: SubagentTask | null
}

interface ChatUiActions {
  setActiveChatId: (chatId: string | null) => void
  setDraft: (chatId: string, draft: string) => void
  setDisclosure: (id: string, open: boolean) => void
  viewSubagentTask: (task: SubagentTask | null) => void
}

type ChatUiStore = ChatUiState & ChatUiActions

export const useChatUiStore = create<ChatUiStore>()(
  devtools(
    (set) => ({
      activeChatId: null,
      draftByChatId: {},
      disclosureById: {},
      viewedSubagentTask: null,
      setActiveChatId: (chatId) =>
        set((state) =>
          state.activeChatId === chatId
            ? state
            : // Leaving a conversation always drops the sub-agent drill-down.
              { activeChatId: chatId, viewedSubagentTask: null }
        ),
      setDraft: (chatId, draft) =>
        set((state) => {
          if (state.draftByChatId[chatId] === draft) return state
          const next = { ...state.draftByChatId }
          if (draft) next[chatId] = draft
          else delete next[chatId]
          return { draftByChatId: next }
        }),
      setDisclosure: (id, open) =>
        set((state) => {
          if (state.disclosureById[id] === open) return state
          return { disclosureById: { ...state.disclosureById, [id]: open } }
        }),
      viewSubagentTask: (task) =>
        set((state) => (state.viewedSubagentTask === task ? state : { viewedSubagentTask: task }))
    }),
    { name: 'chat-ui-store' }
  )
)
