/**
 * Lightweight main-window bounds persistence. No external dependency.
 *
 * Persists `{ x, y, width, height, isMaximized }` to
 * `<userData>/window-state.json`. On load, saved bounds are validated against
 * the current displays so an off-screen position (e.g. after unplugging a
 * monitor) falls back to a centered default.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, screen, type BrowserWindow } from 'electron'
import { createLogger } from './logger'

const log = createLogger('window-state')

const FILE_NAME = 'window-state.json'
/** Minimum overlap (px) with a display work area for saved bounds to be accepted. */
const MIN_VISIBLE = 80
/** Debounce for persisting bounds during resize/move (ms). */
const SAVE_DEBOUNCE_MS = 600

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

/** Bounds passed to the BrowserWindow constructor plus the size constraints. */
export interface InitialWindowState {
  x?: number
  y?: number
  width: number
  height: number
  minWidth: number
  minHeight: number
  isMaximized: boolean
}

function stateFilePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Screen-derived default size and min constraints (matches the pre-persistence sizing). */
function computeDefaults(): { width: number; height: number; minWidth: number; minHeight: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const maxWidth = Math.min(1480, width > 1072 ? width - 48 : width)
  const maxHeight = Math.min(980, height > 728 ? height - 48 : height)
  const minWidth = Math.min(1024, maxWidth)
  const minHeight = Math.min(680, maxHeight)
  return {
    width: Math.round(clamp(width * 0.82, minWidth, maxWidth)),
    height: Math.round(clamp(height * 0.86, minHeight, maxHeight)),
    minWidth,
    minHeight
  }
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Parse and validate the persisted state; returns null when unusable. */
function readState(): WindowState | null {
  let raw: string
  try {
    raw = readFileSync(stateFilePath(), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('failed to read window state', error)
    }
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { x, y, width, height, isMaximized } = parsed as Record<string, unknown>
    if (!isValidNumber(x) || !isValidNumber(y) || !isValidNumber(width) || !isValidNumber(height)) {
      return null
    }
    if (width < 1 || height < 1) return null
    return { x, y, width, height, isMaximized: isMaximized === true }
  } catch (error) {
    log.warn('failed to parse window state', error)
    return null
  }
}

/**
 * True when the bounds keep at least MIN_VISIBLE px of overlap with some
 * display's work area, so the title bar stays reachable.
 */
function isOnScreen(state: WindowState): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(state.x + state.width, workArea.x + workArea.width) - Math.max(state.x, workArea.x)
    const overlapY =
      Math.min(state.y + state.height, workArea.y + workArea.height) - Math.max(state.y, workArea.y)
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE
  })
}

/**
 * Resolve the bounds to open the window with: restored from disk when present
 * and still on-screen, otherwise a centered screen-derived default.
 */
export function getInitialWindowState(): InitialWindowState {
  const defaults = computeDefaults()
  const saved = readState()
  if (saved && isOnScreen(saved)) {
    return {
      x: saved.x,
      y: saved.y,
      width: Math.max(saved.width, defaults.minWidth),
      height: Math.max(saved.height, defaults.minHeight),
      minWidth: defaults.minWidth,
      minHeight: defaults.minHeight,
      isMaximized: saved.isMaximized
    }
  }
  return {
    width: defaults.width,
    height: defaults.height,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    isMaximized: false
  }
}

/**
 * Persist bounds on resize/move (debounced) and immediately on maximize,
 * unmaximize, and close. When maximized, the normal bounds are preserved so
 * restoring later returns to the pre-maximize size.
 */
export function manageWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const persist = (): void => {
    if (window.isDestroyed()) return
    // getNormalBounds returns the restored (non-maximized) bounds even while
    // the window is maximized or in fullscreen.
    const bounds = window.getNormalBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized()
    }
    try {
      writeFileSync(stateFilePath(), JSON.stringify(state))
    } catch (error) {
      log.warn('failed to persist window state', error)
    }
  }

  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', persist)
  window.on('unmaximize', persist)
  window.on('close', () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    persist()
  })
}
