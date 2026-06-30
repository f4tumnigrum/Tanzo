import type { CdpSession } from './cdp-session'

/**
 * Wait until the active page reaches a stable lifecycle state after a
 * navigation, or until `timeoutMs` elapses. Resolves true if the stable signal
 * fired, false on timeout. Used so the agent does not snapshot a half-loaded
 * page right after browserNavigate.
 */
export function waitForStable(session: CdpSession, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (stable: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      offLifecycle()
      offLoad()
      resolve(stable)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const offLifecycle = session.on('Page.lifecycleEvent', (params) => {
      const name = (params as { name?: string }).name
      // "networkAlmostIdle" is the practical "page settled" signal; "load"
      // covers pages with long-lived connections that never reach idle.
      if (name === 'networkAlmostIdle' || name === 'networkIdle') finish(true)
    })
    const offLoad = session.on('Page.loadEventFired', () => finish(true))
  })
}

/** Fixed delay, clamped, for explicit browserWaitFor calls. */
export function delay(ms: number): Promise<void> {
  const clamped = Math.min(Math.max(ms, 0), 30_000)
  return new Promise((resolve) => setTimeout(resolve, clamped))
}
