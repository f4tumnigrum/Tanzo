/**
 * Shared contract for the built-in browser panel. The agent no longer drives
 * pages through the main process; page interaction is handled by the
 * chrome-devtools-mcp server over CDP. The only remaining coupling is a
 * main → renderer request to open the panel at a URL (which creates the
 * `<webview>` target the MCP server then attaches to).
 */

export const BROWSER_CHANNELS = {
  /** Main → renderer: open the browser panel and load a URL (agent-initiated). */
  openRequest: 'browser:open-request'
} as const

export type BrowserChannel = (typeof BROWSER_CHANNELS)[keyof typeof BROWSER_CHANNELS]

/**
 * Payload pushed to the renderer when the agent needs the browser open. The
 * renderer opens the panel and navigates a tab to `url`.
 */
export interface BrowserOpenRequest {
  url: string
}

export interface BrowserControlApi {
  /** Subscribe to agent-initiated requests to open the browser at a URL. */
  onOpenRequest(callback: (request: BrowserOpenRequest) => void): () => void
}
