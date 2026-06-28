import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }))
}))

import {
  EMBEDDED_BROWSER_PARTITION,
  installEmbeddedBrowserHardening,
  isAllowedEmbeddedBrowserUrl
} from '@main/embedded-browser'

describe('isAllowedEmbeddedBrowserUrl', () => {
  it('allows http and https pages with a hostname', () => {
    expect(isAllowedEmbeddedBrowserUrl('https://example.com')).toBe(true)
    expect(isAllowedEmbeddedBrowserUrl('http://localhost:3000/path')).toBe(true)
    expect(isAllowedEmbeddedBrowserUrl('https://sub.example.com/a?b=c#d')).toBe(true)
  })

  it('allows about:blank as the benign initial document', () => {
    expect(isAllowedEmbeddedBrowserUrl('about:blank')).toBe(true)
  })

  it('rejects local and privileged schemes', () => {
    expect(isAllowedEmbeddedBrowserUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl('tanzo-asset://wallpaper/x.png')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl('chrome://settings')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl('about:config')).toBe(false)
  })

  it('rejects malformed, empty, and hostless inputs', () => {
    expect(isAllowedEmbeddedBrowserUrl('')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl('not a url')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl('http://')).toBe(false)
    expect(isAllowedEmbeddedBrowserUrl(undefined as unknown as string)).toBe(false)
  })
})

interface FakeEmitter {
  handlers: Map<string, (...args: unknown[]) => void>
  on: (event: string, cb: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
}

function fakeEmitter(): FakeEmitter {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    handlers,
    on: (event, cb) => {
      handlers.set(event, cb)
    },
    emit: (event, ...args) => handlers.get(event)?.(...args)
  }
}

describe('installEmbeddedBrowserHardening', () => {
  function setup() {
    const contents = fakeEmitter()
    const window = { webContents: contents } as never
    installEmbeddedBrowserHardening(window)
    return contents
  }

  it('blocks attach when the partition does not match', () => {
    const contents = setup()
    const event = { preventDefault: vi.fn() }
    contents.emit(
      'will-attach-webview',
      event,
      {},
      {
        src: 'https://example.com',
        partition: 'wrong'
      }
    )
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('blocks attach for a disallowed src even on the right partition', () => {
    const contents = setup()
    const event = { preventDefault: vi.fn() }
    contents.emit(
      'will-attach-webview',
      event,
      {},
      {
        src: 'file:///etc/passwd',
        partition: EMBEDDED_BROWSER_PARTITION
      }
    )
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('allows and strips preload on a valid attach', () => {
    const contents = setup()
    const event = { preventDefault: vi.fn() }
    const webPreferences: Record<string, unknown> = { preload: '/evil/preload.js' }
    contents.emit('will-attach-webview', event, webPreferences, {
      src: 'https://example.com',
      partition: EMBEDDED_BROWSER_PARTITION
    })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences.preload).toBeUndefined()
    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.contextIsolation).toBe(true)
    expect(webPreferences.sandbox).toBe(true)
  })

  it('gates every guest navigation and denies window.open', () => {
    const contents = setup()
    const guest = fakeEmitter()
    const setWindowOpenHandler = vi.fn()
    const guestContents = { ...guest, setWindowOpenHandler }
    contents.emit('did-attach-webview', {}, guestContents)

    const goodEvent = { preventDefault: vi.fn() }
    guest.emit('will-navigate', goodEvent, 'https://example.org')
    expect(goodEvent.preventDefault).not.toHaveBeenCalled()

    const badEvent = { preventDefault: vi.fn() }
    guest.emit('will-redirect', badEvent, 'file:///etc/passwd')
    expect(badEvent.preventDefault).toHaveBeenCalled()

    expect(setWindowOpenHandler).toHaveBeenCalled()
    const handler = setWindowOpenHandler.mock.calls[0][0] as () => unknown
    expect(handler()).toEqual({ action: 'deny' })
  })
})
