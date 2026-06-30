import {
  BROWSER_CHANNELS,
  type BrowserControlApi,
  type BrowserOpenRequest
} from '@shared/browser-control'
import { invoke, subscribe } from './invoke'

export const browserApi: BrowserControlApi = {
  registerTab: invoke<BrowserControlApi['registerTab']>(BROWSER_CHANNELS.registerTab),
  unregisterTab: invoke<BrowserControlApi['unregisterTab']>(BROWSER_CHANNELS.unregisterTab),
  setActiveTab: invoke<BrowserControlApi['setActiveTab']>(BROWSER_CHANNELS.setActiveTab),
  onOpenRequest: (callback) => subscribe<BrowserOpenRequest>(BROWSER_CHANNELS.openRequest, callback)
}

export type BrowserPreloadApi = typeof browserApi
