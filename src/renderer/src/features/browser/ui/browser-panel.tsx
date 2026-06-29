import { useBrowserUiStore } from '../model/store'
import { BrowserView } from './browser-view'
import { TabStrip } from './tab-strip'

/**
 * Orchestrates the browser tabs. Every tab's `BrowserView` stays mounted while
 * inactive (hidden, not unmounted) so each page keeps its DOM, scroll position,
 * JS state and back/forward history when the user switches tabs.
 */
export function BrowserPanel(): React.JSX.Element {
  const tabs = useBrowserUiStore((s) => s.tabs)
  const activeTabId = useBrowserUiStore((s) => s.activeTabId)

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <TabStrip />
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            // Inactive tabs are kept in the DOM but hidden; `hidden` (not unmount)
            // preserves the live webview behind each tab.
            className="absolute inset-0"
            hidden={tab.id !== activeTabId}
          >
            <BrowserView tab={tab} />
          </div>
        ))}
      </div>
    </div>
  )
}
