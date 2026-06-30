/**
 * Shared contract for the agent-controlled embedded browser. The renderer
 * registers each `<webview>` guest's `WebContents` id against a stable tab id
 * so the main-process BrowserController can drive the exact tab the user sees.
 */

export const BROWSER_CHANNELS = {
  registerTab: 'browser:register-tab',
  unregisterTab: 'browser:unregister-tab',
  setActiveTab: 'browser:set-active-tab',
  /** Main → renderer: open the browser panel and load a URL (agent-initiated). */
  openRequest: 'browser:open-request'
} as const

export type BrowserChannel = (typeof BROWSER_CHANNELS)[keyof typeof BROWSER_CHANNELS]

export interface BrowserTabRegistration {
  tabId: string
  webContentsId: number
  url: string
  title: string
}

/**
 * Payload pushed to the renderer when the agent needs the browser open. The
 * renderer opens the panel and navigates a tab to `url`; the resulting guest
 * registers itself back through `registerTab`, which the controller awaits.
 */
export interface BrowserOpenRequest {
  url: string
}

export interface BrowserControlApi {
  registerTab(reg: BrowserTabRegistration): Promise<void>
  unregisterTab(tabId: string): Promise<void>
  setActiveTab(tabId: string | null): Promise<void>
  /** Subscribe to agent-initiated requests to open the browser at a URL. */
  onOpenRequest(callback: (request: BrowserOpenRequest) => void): () => void
}
