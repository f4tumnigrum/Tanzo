import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const displays = [{ workArea }]
  return {
    app: { getPath: vi.fn() },
    screen: {
      getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1920, height: 1080 }, workArea })),
      getAllDisplays: vi.fn(() => displays)
    },
    displays
  }
})

vi.mock('electron', () => electronMock)

const STATE_FILE = 'window-state.json'

let userDataPath = ''

beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'tanzo-window-state-'))
  electronMock.app.getPath.mockReturnValue(userDataPath)
  // Reset to a single 1920x1080 display for each test.
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  electronMock.displays.splice(0, electronMock.displays.length, { workArea })
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
})

function writeState(state: Record<string, unknown>): Promise<void> {
  return writeFile(join(userDataPath, STATE_FILE), JSON.stringify(state))
}

describe('main/window-state', () => {
  // The primary work area is 1920x1080, so the screen-derived default is
  // width 1480 (capped), height 929 (0.86 * 1080), with 1024x680 minimums.
  const DEFAULT = { width: 1480, height: 929, minWidth: 1024, minHeight: 680 }

  it('returns a centered screen-derived default when no state is saved', async () => {
    const { getInitialWindowState } = await import('@main/window-state')

    const state = getInitialWindowState()

    expect(state).toEqual({ ...DEFAULT, isMaximized: false })
    // No saved position means the window opens centered by the OS.
    expect(state.x).toBeUndefined()
    expect(state.y).toBeUndefined()
  })

  it('restores saved bounds that are still on-screen', async () => {
    await writeState({ x: 120, y: 90, width: 1300, height: 820, isMaximized: false })
    const { getInitialWindowState } = await import('@main/window-state')

    expect(getInitialWindowState()).toEqual({
      x: 120,
      y: 90,
      width: 1300,
      height: 820,
      minWidth: 1024,
      minHeight: 680,
      isMaximized: false
    })
  })

  it('falls back to the default when saved bounds are off-screen', async () => {
    await writeState({ x: 6000, y: 6000, width: 1300, height: 820, isMaximized: false })
    const { getInitialWindowState } = await import('@main/window-state')

    const state = getInitialWindowState()

    expect(state).toEqual({ ...DEFAULT, isMaximized: false })
    expect(state.x).toBeUndefined()
  })

  it('clamps a restored size up to the minimum constraints', async () => {
    await writeState({ x: 100, y: 100, width: 400, height: 300, isMaximized: false })
    const { getInitialWindowState } = await import('@main/window-state')

    const state = getInitialWindowState()

    expect(state.width).toBe(DEFAULT.minWidth)
    expect(state.height).toBe(DEFAULT.minHeight)
    // Position is kept even though the size was clamped.
    expect(state.x).toBe(100)
    expect(state.y).toBe(100)
  })

  it('preserves the maximized flag', async () => {
    await writeState({ x: 100, y: 100, width: 1300, height: 820, isMaximized: true })
    const { getInitialWindowState } = await import('@main/window-state')

    expect(getInitialWindowState().isMaximized).toBe(true)
  })

  it('ignores a corrupt state file', async () => {
    await writeFile(join(userDataPath, STATE_FILE), '{ not valid json')
    const { getInitialWindowState } = await import('@main/window-state')

    expect(getInitialWindowState()).toEqual({ ...DEFAULT, isMaximized: false })
  })

  it('rejects non-finite or non-positive dimensions', async () => {
    await writeState({ x: 0, y: 0, width: 0, height: 800, isMaximized: false })
    const { getInitialWindowState } = await import('@main/window-state')

    expect(getInitialWindowState()).toEqual({ ...DEFAULT, isMaximized: false })
  })

  function fakeWindow(overrides: Partial<Record<string, unknown>> = {}) {
    const listeners = new Map<string, () => void>()
    return {
      listeners,
      window: {
        isDestroyed: () => false,
        getNormalBounds: () => ({ x: 50, y: 60, width: 1300, height: 850 }),
        isMaximized: () => false,
        on: (event: string, cb: () => void) => listeners.set(event, cb),
        ...overrides
      }
    }
  }

  it('persists normal bounds immediately on close', async () => {
    const { manageWindowState, getInitialWindowState } = await import('@main/window-state')
    const { listeners, window } = fakeWindow()

    manageWindowState(window as never)
    listeners.get('close')?.()

    const saved = JSON.parse(await readFile(join(userDataPath, STATE_FILE), 'utf-8'))
    expect(saved).toEqual({ x: 50, y: 60, width: 1300, height: 850, isMaximized: false })
    // The saved state round-trips through the loader.
    expect(getInitialWindowState()).toMatchObject({ x: 50, y: 60, width: 1300, height: 850 })
  })

  it('records the maximized flag when maximizing', async () => {
    const { manageWindowState } = await import('@main/window-state')
    const { listeners, window } = fakeWindow({ isMaximized: () => true })

    manageWindowState(window as never)
    listeners.get('maximize')?.()

    const saved = JSON.parse(await readFile(join(userDataPath, STATE_FILE), 'utf-8'))
    // getNormalBounds keeps the pre-maximize size so a later restore is correct.
    expect(saved).toEqual({ x: 50, y: 60, width: 1300, height: 850, isMaximized: true })
  })

  it('debounces save during resize and move', async () => {
    vi.useFakeTimers()
    try {
      const { manageWindowState } = await import('@main/window-state')
      const { listeners, window } = fakeWindow()

      manageWindowState(window as never)
      listeners.get('resize')?.()
      listeners.get('move')?.()

      // Nothing written yet — the save is debounced.
      await expect(readFile(join(userDataPath, STATE_FILE), 'utf-8')).rejects.toThrow()

      await vi.advanceTimersByTimeAsync(700)
      const saved = JSON.parse(await readFile(join(userDataPath, STATE_FILE), 'utf-8'))
      expect(saved).toMatchObject({ width: 1300, height: 850 })
    } finally {
      vi.useRealTimers()
    }
  })
})
