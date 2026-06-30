import { webContents, type WebContents } from 'electron'
import type { BrowserTabRegistration } from '@shared/browser-control'
import { isAllowedEmbeddedBrowserUrl } from '../../embedded-browser'
import { createLogger } from '../../logger'
import { CdpSession } from './cdp-session'
import { RefMap } from './ref-map'
import { buildSnapshot } from './snapshot'
import {
  clickRef,
  hoverRef,
  pressKey,
  readText as readTextOp,
  scrollBy,
  selectRef,
  typeRef
} from './interaction'
import { delay, waitForStable } from './wait'

const log = createLogger('browser-controller')

export interface BrowserTabInfo {
  tabId: string
  url: string
  title: string
  active: boolean
}

export interface SnapshotResult {
  title: string
  url: string
  tree: string
  nodeCount: number
  truncated: boolean
}

export interface ReadTextResult {
  title: string
  url: string
  text: string
}

export interface ScreenshotResult {
  dataUrl: string
  width: number
  height: number
}

export type BrowserResult<T> = T | { error: string }

interface TabEntry {
  tabId: string
  webContentsId: number
  url: string
  title: string
  /** Lazily attached CDP session; created on first tool use. */
  session?: CdpSession
  /** Ref map for the most recent snapshot of this tab. */
  refMap: RefMap
}

export interface BrowserControllerDeps {
  /**
   * Ask the renderer to open the browser panel and load `url`. The resulting
   * guest registers itself via `registerTab`, which resolves the pending open.
   * Returns false when no renderer window is available to receive the request.
   */
  requestOpen(url: string): boolean
}

/**
 * Tracks the embedded-browser guests the renderer has registered and drives the
 * one the user is looking at, over CDP (`webContents.debugger`). Refs from a
 * snapshot map to backend node ids held in the main process, so the untrusted
 * page can neither see nor forge them. Sessions attach lazily and detach when a
 * tab unregisters or crashes.
 */
export interface BrowserController {
  registerTab(reg: BrowserTabRegistration): void
  unregisterTab(tabId: string): void
  setActiveTab(tabId: string | null): void
  listTabs(): BrowserTabInfo[]
  activateTab(tabId: string): BrowserResult<{ tabId: string }>
  navigate(url: string): Promise<BrowserResult<{ url: string }>>
  goBack(): Promise<BrowserResult<{ ok: true }>>
  goForward(): Promise<BrowserResult<{ ok: true }>>
  snapshot(selector?: string, interactive?: boolean): Promise<BrowserResult<SnapshotResult>>
  readText(ref?: string): Promise<BrowserResult<ReadTextResult>>
  click(ref: string): Promise<BrowserResult<{ ok: true }>>
  type(ref: string, text: string, clear: boolean): Promise<BrowserResult<{ ok: true }>>
  select(ref: string, value: string): Promise<BrowserResult<{ ok: true }>>
  pressKey(key: string): Promise<BrowserResult<{ ok: true }>>
  hover(ref: string): Promise<BrowserResult<{ ok: true }>>
  scroll(dx: number, dy: number): Promise<BrowserResult<{ scrollX: number; scrollY: number }>>
  screenshot(): Promise<BrowserResult<ScreenshotResult>>
  waitFor(ms: number): Promise<BrowserResult<{ ok: true }>>
}

const NO_TAB =
  'No browser tab is open. Use browserNavigate to open a page first — it opens the built-in browser automatically.'
const TAB_GONE = 'The active browser tab is no longer available.'
const OPEN_TIMEOUT_MS = 15_000
const STABLE_TIMEOUT_MS = 10_000
const OPEN_UNAVAILABLE = 'Could not open the built-in browser (no app window is available).'
const OPEN_TIMED_OUT =
  'Timed out waiting for the built-in browser to open. Ask the user to open it manually.'

function refError(code: string): string {
  switch (code) {
    case 'ref-not-found':
      return 'Ref not found or detached. The page changed; take a fresh browserSnapshot.'
    case 'root-not-found':
      return 'Snapshot root selector matched no element.'
    case 'empty-tree':
      return 'The page exposed no accessibility tree yet. Wait for it to load, then re-snapshot.'
    case 'not-editable':
      return 'Target element is not a text field or contenteditable.'
    case 'option-not-found':
      return 'No matching <option> for that value.'
    default:
      return code
  }
}

export function createBrowserController(deps: BrowserControllerDeps): BrowserController {
  const tabs = new Map<string, TabEntry>()
  let activeTabId: string | null = null
  /** Resolvers waiting for a specific URL after an agent-initiated open request. */
  const openWaiters = new Set<{ url: string; resolve: () => void }>()

  function disposeEntry(entry: TabEntry): void {
    entry.session?.dispose()
    entry.session = undefined
    entry.refMap.clear()
  }

  function resolveEntry(): TabEntry | { error: string } {
    if (!activeTabId) {
      const last = [...tabs.values()].at(-1)
      if (!last) return { error: NO_TAB }
      activeTabId = last.tabId
    }
    const entry = tabs.get(activeTabId)
    if (!entry) return { error: NO_TAB }
    const wc = webContents.fromId(entry.webContentsId)
    if (!wc || wc.isDestroyed()) {
      disposeEntry(entry)
      tabs.delete(entry.tabId)
      if (activeTabId === entry.tabId) activeTabId = null
      return { error: TAB_GONE }
    }
    return entry
  }

  /** Resolve the active tab and ensure its CDP session is attached. */
  async function activeSession(): Promise<
    { session: CdpSession; refMap: RefMap; wc: WebContents } | { error: string }
  > {
    const entry = resolveEntry()
    if ('error' in entry) return entry
    const wc = webContents.fromId(entry.webContentsId)!
    if (!entry.session) {
      const session = new CdpSession(wc)
      session.onDetach(() => {
        entry.session = undefined
        entry.refMap.clear()
      })
      entry.session = session
    }
    try {
      await entry.session.attach()
    } catch (error) {
      entry.session = undefined
      return { error: `Could not attach to the page: ${errMsg(error)}` }
    }
    return { session: entry.session, refMap: entry.refMap, wc }
  }

  async function ensureOpen(url: string): Promise<{ error: string } | null> {
    if (tabs.size > 0) return null
    let timer: ReturnType<typeof setTimeout>
    let resolveRegistered!: (registered: boolean) => void
    const waiter = {
      url,
      resolve: (): void => {
        clearTimeout(timer)
        openWaiters.delete(waiter)
        resolveRegistered(true)
      }
    }
    const registeredPromise = new Promise<boolean>((resolve) => {
      resolveRegistered = resolve
      timer = setTimeout(() => {
        openWaiters.delete(waiter)
        resolve(false)
      }, OPEN_TIMEOUT_MS)
      openWaiters.add(waiter)
    })
    const dispatched = deps.requestOpen(url)
    if (!dispatched) {
      clearTimeout(timer!)
      openWaiters.delete(waiter)
      resolveRegistered(false)
      return { error: OPEN_UNAVAILABLE }
    }
    const registered = await registeredPromise
    return registered ? null : { error: OPEN_TIMED_OUT }
  }

  function mapError<T extends { error: string }>(result: T): T {
    return { ...result, error: refError(result.error) }
  }

  return {
    registerTab(reg) {
      const existing = tabs.get(reg.tabId)
      if (existing && existing.webContentsId === reg.webContentsId) {
        existing.url = reg.url
        existing.title = reg.title
      } else {
        if (existing) disposeEntry(existing)
        tabs.set(reg.tabId, {
          tabId: reg.tabId,
          webContentsId: reg.webContentsId,
          url: reg.url,
          title: reg.title,
          refMap: new RefMap()
        })
      }
      if (!activeTabId) activeTabId = reg.tabId
      for (const waiter of [...openWaiters]) {
        if (waiter.url === reg.url) waiter.resolve()
      }
    },

    unregisterTab(tabId) {
      const entry = tabs.get(tabId)
      if (entry) disposeEntry(entry)
      tabs.delete(tabId)
      if (activeTabId === tabId) activeTabId = null
    },

    setActiveTab(tabId) {
      activeTabId = tabId
    },

    listTabs() {
      return [...tabs.values()].map((t) => ({
        tabId: t.tabId,
        url: t.url,
        title: t.title,
        active: t.tabId === activeTabId
      }))
    },

    activateTab(tabId) {
      if (!tabs.has(tabId)) return { error: `Unknown tab ${tabId}.` }
      activeTabId = tabId
      return { tabId }
    },

    async navigate(url) {
      if (!isAllowedEmbeddedBrowserUrl(url)) {
        return { error: `Refusing to navigate to disallowed URL: ${url}` }
      }
      const hadTab = tabs.size > 0
      const opened = await ensureOpen(url)
      if (opened) return opened
      if (!hadTab) return { url }

      const active = await activeSession()
      if ('error' in active) return active
      const { session, wc, refMap } = active
      refMap.clear()
      try {
        const stable = waitForStable(session, STABLE_TIMEOUT_MS)
        await wc.loadURL(url)
        await stable
        return { url }
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async goBack() {
      const active = await activeSession()
      if ('error' in active) return active
      const nav = active.wc.navigationHistory
      if (!nav.canGoBack()) return { error: 'No back history.' }
      active.refMap.clear()
      const stable = waitForStable(active.session, STABLE_TIMEOUT_MS)
      nav.goBack()
      await stable
      return { ok: true as const }
    },

    async goForward() {
      const active = await activeSession()
      if ('error' in active) return active
      const nav = active.wc.navigationHistory
      if (!nav.canGoForward()) return { error: 'No forward history.' }
      active.refMap.clear()
      const stable = waitForStable(active.session, STABLE_TIMEOUT_MS)
      nav.goForward()
      await stable
      return { ok: true as const }
    },

    async snapshot(selector, interactive = true) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const built = await buildSnapshot(active.session, active.refMap, { selector, interactive })
        if ('error' in built) return mapError(built)
        return {
          title: active.wc.getTitle(),
          url: active.wc.getURL(),
          tree: built.tree,
          nodeCount: built.nodeCount,
          truncated: built.truncated
        }
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async readText(ref) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await readTextOp(active.session, active.refMap, ref)
        if ('error' in result) return mapError(result)
        return { title: active.wc.getTitle(), url: active.wc.getURL(), text: result.text }
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async click(ref) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await clickRef(active.session, active.refMap, ref)
        if ('error' in result) {
          if (result.error === 'covered') {
            const covering = (result as { covering?: string }).covering ?? 'another element'
            return {
              error: `Click target is covered by ${covering}. Dismiss it, then re-snapshot.`
            }
          }
          return mapError(result)
        }
        return result
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async type(ref, text, clear) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await typeRef(active.session, active.refMap, ref, text, clear)
        return 'error' in result ? mapError(result) : result
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async select(ref, value) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await selectRef(active.session, active.refMap, ref, value)
        return 'error' in result ? mapError(result) : result
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async pressKey(key) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await pressKey(active.session, key)
        return 'error' in result ? mapError(result) : result
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async hover(ref) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await hoverRef(active.session, active.refMap, ref)
        return 'error' in result ? mapError(result) : result
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async scroll(dx, dy) {
      const active = await activeSession()
      if ('error' in active) return active
      try {
        const result = await scrollBy(active.session, dx, dy)
        return 'error' in result ? mapError(result) : result
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async screenshot() {
      const entry = resolveEntry()
      if ('error' in entry) return entry
      const wc = webContents.fromId(entry.webContentsId)!
      try {
        const image = await wc.capturePage()
        const size = image.getSize()
        return { dataUrl: image.toDataURL(), width: size.width, height: size.height }
      } catch (error) {
        return { error: errMsg(error) }
      }
    },

    async waitFor(ms) {
      const entry = resolveEntry()
      if ('error' in entry) return entry
      await delay(ms)
      return { ok: true as const }
    }
  }
}

function errMsg(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  log.warn('browser action failed', { message })
  return message
}
