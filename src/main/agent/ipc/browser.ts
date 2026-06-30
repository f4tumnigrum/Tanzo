import { webContents, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { z } from 'zod'
import { TanzoValidationError } from '@shared/errors'
import { BROWSER_CHANNELS } from '@shared/browser-control'
import type { AgentIpcDeps, IpcRegistration } from './types'

const registerSchema = z.object({
  tabId: z.string().min(1),
  webContentsId: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string()
})

function assertOwnedWebview(sender: WebContents, webContentsId: number): void {
  const guest = webContents.fromId(webContentsId) as
    | (WebContents & { getType?: () => string; hostWebContents?: WebContents | null })
    | null
  const guestType = guest?.getType?.() ?? null
  const host = guest?.hostWebContents ?? null
  if (!guest || guest.isDestroyed() || guestType !== 'webview' || host?.id !== sender.id) {
    throw new TanzoValidationError(
      'BROWSER_TAB_UNTRUSTED',
      'Browser tab registration did not come from its owning renderer.'
    )
  }
}

export function browserHandlers(deps: AgentIpcDeps): IpcRegistration[] {
  return [
    [
      BROWSER_CHANNELS.registerTab,
      (event, input) => {
        const reg = registerSchema.parse(input)
        assertOwnedWebview((event as IpcMainInvokeEvent).sender, reg.webContentsId)
        deps.browser.registerTab(reg)
      },
      { passEvent: true }
    ],
    [
      BROWSER_CHANNELS.unregisterTab,
      (tabId) => {
        deps.browser.unregisterTab(z.string().min(1).parse(tabId))
      }
    ],
    [
      BROWSER_CHANNELS.setActiveTab,
      (tabId) => {
        deps.browser.setActiveTab(z.union([z.string().min(1), z.null()]).parse(tabId))
      }
    ]
  ]
}
