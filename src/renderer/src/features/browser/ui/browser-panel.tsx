import { useBrowserUiStore } from '../model/store'
import { BrowserView } from './browser-view'
import { TabStrip } from './tab-strip'

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
