import { useEffect } from 'react'
import { browserClient, isBrowserApiAvailable } from '@/platform/electron/browser-client'
import { useBrowserUiStore } from './store'

export function useBrowserOpenRequests(): void {
  const openUrl = useBrowserUiStore((s) => s.openUrl)

  useEffect(() => {
    if (!isBrowserApiAvailable()) return undefined
    return browserClient.onOpenRequest(({ url }) => {
      openUrl(url)
    })
  }, [openUrl])
}
