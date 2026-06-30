import { useEffect } from 'react'
import { useBrowserUiStore } from './store'

/**
 * Bridges agent-initiated open requests (main → renderer) to the browser UI.
 * When the agent calls browserNavigate with no tab open, the main process asks
 * the renderer to open the panel; this opens it and loads the URL in a new tab.
 * The resulting guest registers itself, which resolves the agent's navigate.
 */
export function useBrowserOpenRequests(): void {
  const openUrl = useBrowserUiStore((s) => s.openUrl)

  useEffect(() => {
    const api = window.electron?.browser
    if (!api) return undefined
    return api.onOpenRequest(({ url }) => {
      openUrl(url)
    })
  }, [openUrl])
}
