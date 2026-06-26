import { join, normalize, sep } from 'path'
import { release } from 'node:os'
import { fileURLToPath } from 'url'
import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { detectNativeWindowEffect } from '@shared/system'
import icon from '../../resources/Tanzo.png?asset'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function initialBounds() {
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

function isAllowedNavigation(url: string): boolean {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    try {
      return new URL(url).origin === new URL(rendererUrl).origin
    } catch {
      return false
    }
  }

  if (!url.startsWith('file://')) return false
  try {
    const target = normalize(fileURLToPath(url))
    const root = normalize(join(__dirname, '../renderer'))
    return target === join(root, 'index.html') || target.startsWith(`${root}${sep}`)
  } catch {
    return false
  }
}

export function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const effect = detectNativeWindowEffect(process.platform, release())

  const macOptions: BrowserWindowConstructorOptions = {
    titleBarStyle: 'hiddenInset',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active'
  }

  const winOptions: BrowserWindowConstructorOptions = {
    frame: false,
    ...(effect === 'acrylic'
      ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
      : { backgroundColor: '#101214' })
  }

  const window = new BrowserWindow({
    ...initialBounds(),
    show: false,
    autoHideMenuBar: true,
    title: 'Tanzo',
    ...(isMac ? macOptions : isWindows ? winOptions : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: true,
      additionalArguments: effect ? [`--window-effect=${effect}`] : []
    }
  })

  if (isMac) {
    window.setWindowButtonVisibility(false)
  }

  window.once('ready-to-show', () => {
    window.show()
    if (is.dev) window.webContents.openDevTools({ mode: 'detach' })
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
