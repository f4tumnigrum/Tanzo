import type { DOMAttributes } from 'react'

export interface WebviewHTMLAttributes<T> extends DOMAttributes<T> {
  src?: string
  partition?: string
  allowpopups?: boolean
  useragent?: string

  webpreferences?: string
  class?: string
  className?: string
  style?: React.CSSProperties
}

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
  getWebContentsId(): number
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewHTMLAttributes<WebviewElement> & { ref?: React.Ref<WebviewElement> }
    }
  }
}
