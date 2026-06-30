import type { Debugger, WebContents } from 'electron'
import { createLogger } from '../../logger'

const log = createLogger('cdp-session')

/** CDP protocol version Electron's embedded Chromium speaks. */
const CDP_PROTOCOL_VERSION = '1.3'

type EventHandler = (params: unknown) => void

/**
 * Thin wrapper around `webContents.debugger`. Owns the attach lifecycle for one
 * guest `WebContents`, serializes command sends, and fans CDP events out to
 * subscribers. All snapshot/interaction logic drives the page through here, so
 * the untrusted page's JS never sees our refs or commands.
 *
 * One session per WebContents id; the controller caches them and disposes on
 * tab unregister or crash.
 */
export class CdpSession {
  private readonly dbg: Debugger
  private attached = false
  private readonly handlers = new Map<string, Set<EventHandler>>()
  private readonly detachListeners = new Set<() => void>()

  constructor(private readonly wc: WebContents) {
    this.dbg = wc.debugger
  }

  /** Attach the debugger and enable the domains every browser tool relies on. */
  async attach(): Promise<void> {
    if (this.attached) return
    if (this.wc.isDestroyed()) throw new Error('WebContents is destroyed')
    try {
      this.dbg.attach(CDP_PROTOCOL_VERSION)
    } catch (error) {
      // Already attached (e.g. DevTools open) surfaces as a throw; treat a
      // genuine "already attached" as usable, rethrow anything else.
      if (!this.dbg.isAttached()) throw error
    }
    this.attached = true

    this.dbg.on('message', (_event, method, params) => {
      const set = this.handlers.get(method)
      if (!set) return
      for (const handler of set) handler(params)
    })
    this.dbg.on('detach', () => {
      this.attached = false
      for (const listener of this.detachListeners) listener()
    })

    await this.send('DOM.enable')
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Accessibility.enable')
  }

  isAttached(): boolean {
    return this.attached && this.dbg.isAttached()
  }

  /** Send a CDP command, returning its typed result. */
  async send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!this.isAttached()) {
      await this.attach()
    }
    return (await this.dbg.sendCommand(method, params ?? {})) as T
  }

  /** Subscribe to a CDP event; returns an unsubscribe function. */
  on(method: string, handler: EventHandler): () => void {
    let set = this.handlers.get(method)
    if (!set) {
      set = new Set()
      this.handlers.set(method, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }

  /** Register a callback fired when the debugger detaches (crash/devtools/close). */
  onDetach(listener: () => void): () => void {
    this.detachListeners.add(listener)
    return () => {
      this.detachListeners.delete(listener)
    }
  }

  dispose(): void {
    this.handlers.clear()
    this.detachListeners.clear()
    if (this.dbg.isAttached()) {
      try {
        this.dbg.detach()
      } catch (error) {
        log.warn('debugger detach failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    this.attached = false
  }
}
