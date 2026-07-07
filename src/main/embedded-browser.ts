import type { WebContents, BrowserWindow } from 'electron'
import { createLogger } from './logger'

const log = createLogger('embedded-browser')

export const EMBEDDED_BROWSER_PARTITION = 'embedded-browser'

export function isAllowedEmbeddedBrowserUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false

  if (rawUrl === 'about:blank') return true

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  if (url.hostname.length === 0) return false

  return true
}

export function installEmbeddedBrowserHardening(window: BrowserWindow): void {
  const contents = window.webContents

  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : ''
    const partition = typeof params.partition === 'string' ? params.partition : ''

    if (partition !== EMBEDDED_BROWSER_PARTITION || !isAllowedEmbeddedBrowserUrl(src)) {
      log.warn('blocked webview attach', { src, partition })
      event.preventDefault()
      return
    }

    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
  })

  contents.on('did-attach-webview', (_event, guest: WebContents) => {
    const blockDisallowed = (navEvent: { preventDefault: () => void }, url: string): void => {
      if (isAllowedEmbeddedBrowserUrl(url)) return
      log.warn('blocked webview navigation', { url })
      navEvent.preventDefault()
    }

    guest.on('will-navigate', blockDisallowed)
    guest.on('will-redirect', blockDisallowed)

    guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
