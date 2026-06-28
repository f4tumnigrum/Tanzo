import type { WebContents, BrowserWindow } from 'electron'
import { createLogger } from './logger'

const log = createLogger('embedded-browser')

/**
 * Partition reserved for the embedded browser's `<webview>` guests. Keeping
 * guests on a dedicated, non-persistent partition isolates their cookies,
 * storage, and cache from both the Tanzo renderer and each other across runs.
 */
export const EMBEDDED_BROWSER_PARTITION = 'embedded-browser'

/**
 * Only real, remote web pages are allowed inside the embedded browser. We
 * deliberately reject every non-http(s) scheme — `file:`, `data:`,
 * `tanzo-asset:`, `chrome:`, `about:` (except blank), and so on — so a
 * compromised renderer or a pasted address cannot point a guest at local
 * files or privileged resources and exfiltrate them through the host.
 */
export function isAllowedEmbeddedBrowserUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false
  // about:blank is the benign initial document of a freshly attached guest.
  if (rawUrl === 'about:blank') return true

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  // A hostname is required; `http://` with no host is not a navigable page.
  if (url.hostname.length === 0) return false

  return true
}

/**
 * Harden every `<webview>` guest attached to the given window.
 *
 * `will-attach-webview` only vets the *initial* `src`. The browser panel
 * navigates an already-attached guest with `webview.loadURL(...)`, which does
 * not re-trigger attach, so the same allowlist must gate every subsequent
 * navigation too — otherwise a guest could be steered to `file:///…` after its
 * first http(s) load.
 */
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

    // Guests never get a preload or Node access; they are untrusted web pages.
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
    // Pop-ups / window.open from guest pages open in the system browser, never
    // as a new uncontrolled Electron window.
    guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
