import type { BrowserControlApi, BrowserOpenRequest } from '@shared/browser-control'
import { TanzoIntegrationError } from '@shared/errors'

function requireBrowserApi(): BrowserControlApi {
  const browserApi = window.electron?.browser
  if (!browserApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_BROWSER_API_UNAVAILABLE',
      'Electron browser API is not available'
    )
  }
  return browserApi
}

export function isBrowserApiAvailable(): boolean {
  return Boolean(window.electron?.browser)
}

export const browserClient = {
  onOpenRequest(callback: (request: BrowserOpenRequest) => void): () => void {
    return requireBrowserApi().onOpenRequest(callback)
  }
}
