import type { DOMAttributes } from 'react'

/**
 * Minimal typing for Electron's non-standard `<webview>` tag so it can be used
 * from JSX. We only declare the attributes the embedded browser actually sets;
 * the runtime element exposes far more, accessed through a typed ref below.
 */
export interface WebviewHTMLAttributes<T> extends DOMAttributes<T> {
  src?: string
  partition?: string
  allowpopups?: boolean
  useragent?: string
  // `webpreferences` is a comma-separated string, e.g. "contextIsolation=yes".
  webpreferences?: string
  class?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * The subset of Electron's WebviewTag API the browser panel drives. Methods
 * mirror `Electron.WebviewTag`; kept narrow on purpose.
 */
export interface WebviewElement extends HTMLElement {
  src: string
  loadURL(url: string): Promise<void>
  getURL(): string
  reload(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getTitle(): string
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewHTMLAttributes<WebviewElement> & { ref?: React.Ref<WebviewElement> }
    }
  }
}
