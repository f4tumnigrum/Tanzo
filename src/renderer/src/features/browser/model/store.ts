import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { normalizeAddressInput } from './normalize-url'

const DEFAULT_HOME = 'https://www.google.com'

let tabSeq = 0
const nextTabId = (): string => `tab-${Date.now().toString(36)}-${(tabSeq++).toString(36)}`

export interface BrowserTab {
  id: string
  /** The URL used to seed the webview's initial load. Never rebound after mount. */
  initialUrl: string
  /** Live committed page URL, kept in sync from the view's navigation events. */
  url: string
  /** Document title, updated from `page-title-updated`. */
  title: string
  loading: boolean
}

interface BrowserUiState {
  open: boolean
  /** When true the browser fills the content area, collapsing the chat pane. */
  maximized: boolean
  tabs: BrowserTab[]
  activeTabId: string | null
}

interface BrowserUiActions {
  setOpen: (open: boolean) => void
  toggle: () => void
  setMaximized: (maximized: boolean) => void
  toggleMaximized: () => void
  /** Open the panel and navigate to a URL (e.g. from a link in chat) in a new tab. */
  openUrl: (url: string) => void
  /** Add a blank tab and focus it. Returns the new tab id. */
  newTab: (url?: string) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  /** Sync a tab's live metadata from its view. */
  updateTab: (id: string, patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'loading'>>) => void
}

type BrowserUiStore = BrowserUiState & BrowserUiActions

function makeTab(url: string): BrowserTab {
  return { id: nextTabId(), initialUrl: url, url, title: '', loading: false }
}

function initialTabs(): BrowserTab[] {
  return [makeTab(DEFAULT_HOME)]
}

export const useBrowserUiStore = create<BrowserUiStore>()(
  devtools(
    (set) => {
      const seed = initialTabs()
      return {
        open: false,
        maximized: false,
        tabs: seed,
        activeTabId: seed[0]?.id ?? null,

        setOpen: (open) =>
          set((state) =>
            state.open === open ? state : { open, maximized: open ? state.maximized : false }
          ),
        toggle: () =>
          set((state) => ({ open: !state.open, maximized: state.open ? false : state.maximized })),
        setMaximized: (maximized) =>
          set((state) => (state.maximized === maximized ? state : { maximized })),
        toggleMaximized: () => set((state) => ({ maximized: !state.maximized })),

        openUrl: (url) => {
          const normalized = normalizeAddressInput(url)
          if (!normalized) return
          const tab = makeTab(normalized)
          set((state) => ({ open: true, tabs: [...state.tabs, tab], activeTabId: tab.id }))
        },

        newTab: (url) => {
          const tab = makeTab(normalizeAddressInput(url ?? '') ?? DEFAULT_HOME)
          set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
          return tab.id
        },

        closeTab: (id) =>
          set((state) => {
            const idx = state.tabs.findIndex((tk) => tk.id === id)
            if (idx === -1) return state
            const tabs = state.tabs.filter((tk) => tk.id !== id)
            // Closing the last tab leaves a fresh blank one so the panel is never empty.
            if (tabs.length === 0) {
              const fresh = makeTab(DEFAULT_HOME)
              return { tabs: [fresh], activeTabId: fresh.id }
            }
            let activeTabId = state.activeTabId
            if (activeTabId === id) {
              const neighbor = tabs[Math.min(idx, tabs.length - 1)]
              activeTabId = neighbor.id
            }
            return { tabs, activeTabId }
          }),

        setActiveTab: (id) =>
          set((state) => {
            if (state.activeTabId === id) return state
            return { activeTabId: id }
          }),

        updateTab: (id, patch) =>
          set((state) => {
            const tabs = state.tabs.map((tk) => (tk.id === id ? { ...tk, ...patch } : tk))
            return { tabs }
          })
      }
    },
    { name: 'browser-ui-store' }
  )
)

// Surface the active tab's URL for callers that still want a single value.
export function useActiveTabUrl(): string {
  return useBrowserUiStore((s) => s.tabs.find((tk) => tk.id === s.activeTabId)?.url ?? DEFAULT_HOME)
}

export { DEFAULT_HOME }
