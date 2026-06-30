import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }))
}))

const fakeContents = new Map<number, FakeWebContents>()

vi.mock('electron', () => ({
  webContents: {
    fromId: (id: number) => fakeContents.get(id) ?? null
  }
}))

import { createBrowserController } from '@main/agent/browser/controller'

type CdpHandler = (params: Record<string, unknown>) => unknown

interface FakeDebugger {
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
  isAttached: () => boolean
  on: ReturnType<typeof vi.fn>
  sendCommand: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface FakeWebContents {
  isDestroyed(): boolean
  getURL(): string
  getTitle(): string
  capturePage: ReturnType<typeof vi.fn>
  navigationHistory: {
    canGoBack: () => boolean
    canGoForward: () => boolean
    goBack: () => void
    goForward: () => void
  }
  debugger: FakeDebugger
  emitCdp(method: string, params?: Record<string, unknown>): void
  loadURL: ReturnType<typeof vi.fn>
}

/**
 * Build a fake WebContents whose debugger answers CDP commands from a handler
 * map. Unhandled commands resolve to `{}` so attach's enable calls succeed.
 */
function makeContents(handlers: Record<string, CdpHandler> = {}): FakeWebContents {
  let attached = false
  const listeners = new Map<string, (e: unknown, ...a: unknown[]) => void>()
  const dbg: FakeDebugger = {
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: () => attached,
    on: vi.fn((event: string, cb: (e: unknown, ...a: unknown[]) => void) => {
      listeners.set(event, cb)
    }),
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const handler = handlers[method]
      return handler ? handler(params ?? {}) : {}
    })
  }
  return {
    isDestroyed: () => false,
    getURL: () => 'https://x.test/',
    getTitle: () => 'X',
    capturePage: vi.fn(async () => ({
      getSize: () => ({ width: 2, height: 1 }),
      toDataURL: () => 'data:image/png;base64,AA'
    })),
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn()
    },
    debugger: dbg,
    emitCdp(method: string, params: Record<string, unknown> = {}) {
      listeners.get('message')?.({}, method, params)
    },
    loadURL: vi.fn(async () => undefined)
  }
}

function makeController(requestOpen = vi.fn(() => true)) {
  return { controller: createBrowserController({ requestOpen }), requestOpen }
}

/** A two-node AX tree: a root WebArea with one button child. */
function axButtonTree() {
  return {
    'Accessibility.getFullAXTree': () => ({
      nodes: [
        {
          nodeId: '1',
          ignored: false,
          role: { type: 'role', value: 'WebArea' },
          name: { type: 'computedString', value: '' },
          childIds: ['2'],
          backendDOMNodeId: 100
        },
        {
          nodeId: '2',
          ignored: false,
          role: { type: 'role', value: 'button' },
          name: { type: 'computedString', value: 'Go' },
          childIds: [],
          backendDOMNodeId: 200
        }
      ]
    })
  }
}

describe('BrowserController (CDP)', () => {
  beforeEach(() => {
    fakeContents.clear()
  })

  it('errors when no tab is registered', async () => {
    const { controller } = makeController()
    const result = await controller.snapshot()
    expect(result).toMatchObject({ error: expect.stringContaining('browserNavigate') })
  })

  it('builds a snapshot with @eN refs from the AX tree', async () => {
    fakeContents.set(7, makeContents(axButtonTree()))
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 7, url: 'https://x.test/', title: 'X' })

    const snap = await controller.snapshot()
    expect(snap).toMatchObject({ nodeCount: 1 })
    expect((snap as { tree: string }).tree).toContain('@e1 [button] "Go"')
  })

  it('omits content nodes in interactive mode but includes them in full mode', async () => {
    const treeWithHeading = {
      'Accessibility.getFullAXTree': () => ({
        nodes: [
          {
            nodeId: '1',
            ignored: false,
            role: { type: 'role', value: 'WebArea' },
            name: { type: 'computedString', value: '' },
            childIds: ['2', '3'],
            backendDOMNodeId: 100
          },
          {
            nodeId: '2',
            ignored: false,
            role: { type: 'role', value: 'heading' },
            name: { type: 'computedString', value: 'Welcome' },
            childIds: [],
            backendDOMNodeId: 200
          },
          {
            nodeId: '3',
            ignored: false,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Go' },
            childIds: [],
            backendDOMNodeId: 300
          }
        ]
      })
    }
    fakeContents.set(1, makeContents(treeWithHeading))
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })

    const interactive = (await controller.snapshot()) as { tree: string; nodeCount: number }
    expect(interactive.tree).toContain('button')
    expect(interactive.tree).not.toContain('heading')
    expect(interactive.nodeCount).toBe(1)

    const full = (await controller.snapshot(undefined, false)) as {
      tree: string
      nodeCount: number
    }
    expect(full.tree).toContain('heading')
    expect(full.tree).toContain('button')
    expect(full.nodeCount).toBe(2)
  })

  it('returns a placeholder when no interactive elements exist', async () => {
    const emptyTree = {
      'Accessibility.getFullAXTree': () => ({
        nodes: [
          {
            nodeId: '1',
            ignored: false,
            role: { type: 'role', value: 'WebArea' },
            name: { type: 'computedString', value: '' },
            childIds: ['2'],
            backendDOMNodeId: 100
          },
          {
            nodeId: '2',
            ignored: false,
            role: { type: 'role', value: 'heading' },
            name: { type: 'computedString', value: 'Just text' },
            childIds: [],
            backendDOMNodeId: 200
          }
        ]
      })
    }
    fakeContents.set(1, makeContents(emptyTree))
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })

    const snap = (await controller.snapshot()) as { tree: string; nodeCount: number }
    expect(snap.tree).toBe('(no interactive elements)')
    expect(snap.nodeCount).toBe(0)
  })

  it('clicks a ref via real mouse events after a snapshot', async () => {
    const calls: string[] = []
    const wc = makeContents({
      ...axButtonTree(),
      'DOM.getBoxModel': () => ({
        model: { content: [0, 0, 10, 0, 10, 10, 0, 10], width: 10, height: 10 }
      }),
      'DOM.getNodeForLocation': () => ({ backendNodeId: 200 }),
      'Input.dispatchMouseEvent': (p) => {
        calls.push(String((p as { type: string }).type))
        return {}
      }
    })
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })
    await controller.snapshot()

    const result = await controller.click('e1')
    expect(result).toMatchObject({ ok: true })
    expect(calls).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
  })

  it('reports the covering element when the click point is occluded', async () => {
    const wc = makeContents({
      ...axButtonTree(),
      'DOM.getBoxModel': () => ({
        model: { content: [0, 0, 10, 0, 10, 10, 0, 10], width: 10, height: 10 }
      }),
      'DOM.getNodeForLocation': () => ({ backendNodeId: 999 }),
      'DOM.describeNode': () => ({
        node: { nodeName: 'DIV', attributes: ['aria-label', 'Accept cookies'] }
      }),
      'DOM.resolveNode': () => ({ object: { objectId: 'obj' } }),
      'Runtime.callFunctionOn': () => ({ result: { value: false } })
    })
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })
    await controller.snapshot()

    const result = await controller.click('e1')
    expect(result).toMatchObject({ error: expect.stringContaining('Accept cookies') })
  })

  it('returns a fresh-snapshot hint for an unknown ref', async () => {
    fakeContents.set(1, makeContents(axButtonTree()))
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })
    await controller.snapshot()

    const result = await controller.click('e99')
    expect(result).toMatchObject({ error: expect.stringContaining('fresh browserSnapshot') })
  })

  it('types into a field via DOM.focus + Input.insertText', async () => {
    let inserted = ''
    const wc = makeContents({
      ...axButtonTree(),
      'DOM.focus': () => ({}),
      'DOM.resolveNode': () => ({ object: { objectId: 'obj' } }),
      'Runtime.callFunctionOn': () => ({ result: {} }),
      'Input.insertText': (p) => {
        inserted = String((p as { text: string }).text)
        return {}
      }
    })
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })
    await controller.snapshot()

    const result = await controller.type('e1', 'hello', true)
    expect(result).toMatchObject({ ok: true })
    expect(inserted).toBe('hello')
  })

  it('refuses to navigate to a disallowed URL', async () => {
    const wc = makeContents()
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'about:blank', title: '' })

    const result = await controller.navigate('file:///etc/passwd')
    expect(result).toMatchObject({ error: expect.stringContaining('disallowed') })
    expect(wc.loadURL).not.toHaveBeenCalled()
  })

  it('auto-opens the browser when navigating with no tab', async () => {
    const wc = makeContents()
    const { controller, requestOpen } = makeController(
      vi.fn((url: string) => {
        fakeContents.set(9, wc)
        queueMicrotask(() =>
          controller.registerTab({ tabId: 'auto', webContentsId: 9, url, title: '' })
        )
        return true
      })
    )

    const result = await controller.navigate('https://example.com/')
    expect(requestOpen).toHaveBeenCalledWith('https://example.com/')
    expect(result).toMatchObject({ url: 'https://example.com/' })
    expect(wc.loadURL).not.toHaveBeenCalled()
  })

  it('auto-open waits for the requested URL instead of the first restored tab', async () => {
    const oldTab = makeContents()
    const requestedTab = makeContents()
    const { controller, requestOpen } = makeController(
      vi.fn((url: string) => {
        fakeContents.set(1, oldTab)
        fakeContents.set(2, requestedTab)
        queueMicrotask(() => {
          controller.registerTab({
            tabId: 'old',
            webContentsId: 1,
            url: 'https://old.test/',
            title: 'Old'
          })
          controller.setActiveTab('auto')
          controller.registerTab({ tabId: 'auto', webContentsId: 2, url, title: 'Requested' })
        })
        return true
      })
    )

    const result = await controller.navigate('https://example.com/')
    expect(requestOpen).toHaveBeenCalledWith('https://example.com/')
    expect(result).toMatchObject({ url: 'https://example.com/' })
    expect(controller.listTabs().find((t) => t.active)?.tabId).toBe('auto')
  })

  it('updates metadata for the same registered guest without detaching the CDP session', async () => {
    const wc = makeContents()
    fakeContents.set(1, wc)
    const { controller } = makeController()
    wc.loadURL.mockImplementation(async (url: string) => {
      controller.registerTab({ tabId: 't', webContentsId: 1, url, title: 'Navigated' })
      wc.emitCdp('Page.loadEventFired')
    })
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: 'X' })
    await controller.snapshot()

    const result = await controller.navigate('https://next.test/')

    expect(result).toMatchObject({ url: 'https://next.test/' })
    expect(wc.debugger.detach).not.toHaveBeenCalled()
    expect(controller.listTabs()[0]).toMatchObject({
      url: 'https://next.test/',
      title: 'Navigated'
    })
  })

  it('reports when the browser cannot be opened', async () => {
    const { controller } = makeController(vi.fn(() => false))
    const result = await controller.navigate('https://example.com/')
    expect(result).toMatchObject({ error: expect.stringContaining('Could not open') })
  })

  it('drops a destroyed tab and reports it is gone', async () => {
    const wc = makeContents()
    wc.isDestroyed = () => true
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: '' })

    const result = await controller.snapshot()
    expect(result).toMatchObject({ error: expect.stringContaining('no longer available') })
    expect(controller.listTabs()).toHaveLength(0)
  })

  it('lists tabs and switches the active target', async () => {
    fakeContents.set(1, makeContents())
    fakeContents.set(2, makeContents())
    const { controller } = makeController()
    controller.registerTab({ tabId: 'a', webContentsId: 1, url: 'https://a.test/', title: 'A' })
    controller.registerTab({ tabId: 'b', webContentsId: 2, url: 'https://b.test/', title: 'B' })

    expect(controller.listTabs().find((t) => t.active)?.tabId).toBe('a')
    expect(controller.activateTab('b')).toMatchObject({ tabId: 'b' })
    expect(controller.listTabs().find((t) => t.active)?.tabId).toBe('b')
    expect(controller.activateTab('missing')).toMatchObject({ error: expect.any(String) })
  })

  it('captures a screenshot as a data URL', async () => {
    fakeContents.set(1, makeContents())
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: '' })

    const result = await controller.screenshot()
    expect(result).toMatchObject({ dataUrl: 'data:image/png;base64,AA', width: 2, height: 1 })
  })

  it('selects a dropdown option by value', async () => {
    const wc = makeContents({
      ...axButtonTree(),
      'DOM.resolveNode': () => ({ object: { objectId: 'sel' } }),
      'Runtime.callFunctionOn': () => ({ result: { value: true } })
    })
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: '' })
    await controller.snapshot()

    const result = await controller.select('e1', 'US')
    expect(result).toMatchObject({ ok: true })
  })

  it('presses a supported key and rejects unsupported ones', async () => {
    const wc = makeContents({ 'Input.dispatchKeyEvent': () => ({}) })
    fakeContents.set(1, wc)
    const { controller } = makeController()
    controller.registerTab({ tabId: 't', webContentsId: 1, url: 'https://x.test/', title: '' })

    expect(await controller.pressKey('Enter')).toMatchObject({ ok: true })
    expect(await controller.pressKey('F13' as never)).toMatchObject({ error: expect.any(String) })
  })
})
