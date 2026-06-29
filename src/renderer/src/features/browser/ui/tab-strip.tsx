import { useTranslation } from 'react-i18next'
import { Globe, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBrowserUiStore, type BrowserTab } from '../model/store'

function tabLabel(tab: BrowserTab): string {
  if (tab.title.trim()) return tab.title.trim()
  try {
    return new URL(tab.url).hostname.replace(/^www\./, '') || tab.url
  } catch {
    return tab.url
  }
}

export function TabStrip(): React.JSX.Element | null {
  const { t } = useTranslation()
  const tabs = useBrowserUiStore((s) => s.tabs)
  const activeTabId = useBrowserUiStore((s) => s.activeTabId)
  const setActiveTab = useBrowserUiStore((s) => s.setActiveTab)
  const closeTab = useBrowserUiStore((s) => s.closeTab)

  // A single tab carries no information the address bar doesn't already show,
  // so the strip only appears once there are multiple tabs. The new-tab button
  // lives in the toolbar, so the chrome stays a single row at one tab.
  if (tabs.length < 2) return null

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto px-2 pt-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setActiveTab(tab.id)
              }
            }}
            onAuxClick={(e) => {
              // Middle-click closes the tab, matching browser convention.
              if (e.button === 1) {
                e.preventDefault()
                closeTab(tab.id)
              }
            }}
            className={cn(
              'group/tab flex h-8 min-w-0 max-w-[13rem] shrink-0 cursor-default items-center gap-1.5 rounded-md px-2.5 text-[0.74rem] transition-colors',
              active
                ? 'bg-foreground/[0.06] text-foreground/85'
                : 'text-foreground/55 hover:bg-foreground/[0.035] hover:text-foreground/75'
            )}
          >
            {tab.loading ? (
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-foreground/40"
                aria-hidden="true"
              />
            ) : (
              <Globe className="size-3.5 shrink-0 text-foreground/35" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              aria-label={t('browser.tabs.close')}
              className={cn(
                '-mr-0.5 grid size-5 shrink-0 place-items-center rounded transition-colors hover:bg-foreground/[0.1] hover:text-foreground/80',
                active
                  ? 'text-foreground/40'
                  : 'text-foreground/0 group-hover/tab:text-foreground/40'
              )}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
