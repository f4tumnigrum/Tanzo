import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TanzoValidationError } from '@shared/errors'
import { BROWSER_CHANNELS } from '@shared/browser-control'

const electronMock = vi.hoisted(() => {
  const contents = new Map<number, unknown>()
  return {
    contents,
    webContents: {
      fromId: vi.fn((id: number) => contents.get(id) ?? null)
    }
  }
})

vi.mock('electron', () => ({ webContents: electronMock.webContents }))

import { browserHandlers } from '@main/agent/ipc/browser'

function deps() {
  return {
    browser: {
      registerTab: vi.fn(),
      unregisterTab: vi.fn(),
      setActiveTab: vi.fn()
    }
  }
}

function event(senderId: number) {
  return { sender: { id: senderId } }
}

function guest(hostId: number, options: { destroyed?: boolean; type?: string } = {}) {
  return {
    isDestroyed: () => options.destroyed ?? false,
    getType: () => options.type ?? 'webview',
    hostWebContents: { id: hostId }
  }
}

describe('agent/ipc/browser', () => {
  beforeEach(() => {
    electronMock.contents.clear()
    electronMock.webContents.fromId.mockClear()
  })

  it('accepts tab registrations only from the owning renderer', () => {
    electronMock.contents.set(10, guest(1))
    const fakeDeps = deps()
    const handler = browserHandlers(fakeDeps as never).find(
      ([channel]) => channel === BROWSER_CHANNELS.registerTab
    )?.[1]

    handler?.(event(1), { tabId: 'tab-1', webContentsId: 10, url: 'https://x.test/', title: 'X' })

    expect(fakeDeps.browser.registerTab).toHaveBeenCalledWith({
      tabId: 'tab-1',
      webContentsId: 10,
      url: 'https://x.test/',
      title: 'X'
    })
  })

  it('rejects registrations for guests the sender does not own', () => {
    electronMock.contents.set(10, guest(2))
    const fakeDeps = deps()
    const handler = browserHandlers(fakeDeps as never).find(
      ([channel]) => channel === BROWSER_CHANNELS.registerTab
    )?.[1]

    expect(() =>
      handler?.(event(1), { tabId: 'tab-1', webContentsId: 10, url: 'https://x.test/', title: 'X' })
    ).toThrow(TanzoValidationError)
    expect(fakeDeps.browser.registerTab).not.toHaveBeenCalled()
  })
})
