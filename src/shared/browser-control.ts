export const BROWSER_CHANNELS = {
  openRequest: 'browser:open-request'
} as const

export type BrowserChannel = (typeof BROWSER_CHANNELS)[keyof typeof BROWSER_CHANNELS]

export interface BrowserOpenRequest {
  url: string
}

export interface BrowserControlApi {
  onOpenRequest(callback: (request: BrowserOpenRequest) => void): () => void
}
