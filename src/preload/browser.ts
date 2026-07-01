import {
  BROWSER_CHANNELS,
  type BrowserControlApi,
  type BrowserOpenRequest
} from '@shared/browser-control'
import { subscribe } from './invoke'

export const browserApi: BrowserControlApi = {
  onOpenRequest: (callback) => subscribe<BrowserOpenRequest>(BROWSER_CHANNELS.openRequest, callback)
}

export type BrowserPreloadApi = typeof browserApi
