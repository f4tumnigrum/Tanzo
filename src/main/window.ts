import { join, normalize, sep } from 'path'
import { release } from 'node:os'
import { fileURLToPath } from 'url'
import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { detectNativeWindowEffect } from '@shared/system'
import { installEmbeddedBrowserHardening } from './embedded-browser'
import { getInitialWindowState, manageWindowState } from './window-state'
import icon from '../../resources/Tanzo.png?asset'

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
    titleBarStyle: 'hidden',
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

  const initialState = getInitialWindowState()

  const window = new BrowserWindow({
    x: initialState.x,
    y: initialState.y,
    width: initialState.width,
    height: initialState.height,
    minWidth: initialState.minWidth,
    minHeight: initialState.minHeight,
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
      webviewTag: true,
      additionalArguments: effect ? [`--window-effect=${effect}`] : []
    }
  })

  installEmbeddedBrowserHardening(window)
  manageWindowState(window)

  if (isMac) {
    window.setWindowButtonVisibility(false)
  }

  window.once('ready-to-show', () => {
    if (initialState.isMaximized) window.maximize()
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
