import { app, ipcMain, type BrowserWindow, type IpcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UPDATER_CHANNELS, INITIAL_UPDATER_STATE, type UpdaterState } from '@shared/updater'
import { createLogger } from './logger'

const log = createLogger('updater')

let state: UpdaterState = { ...INITIAL_UPDATER_STATE }
let getWindow: () => BrowserWindow | null = () => null

function setState(next: Partial<UpdaterState>): void {
  state = { ...state, ...next }
  const window = getWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(UPDATER_CHANNELS.stateChanged, state)
}

/**
 * Wire up manual auto-update for Windows and Linux (AppImage) only.
 *
 * Unlike a silent updater, this never downloads on its own: it checks the feed,
 * and when a newer version exists it surfaces an `available` state to the
 * renderer. The user starts the download and the install explicitly.
 *
 * macOS is intentionally skipped: `electron-updater` refuses to apply updates
 * on macOS unless the app is code-signed, and this build ships unsigned. macOS
 * users update by downloading a new DMG from the GitHub release.
 *
 * Only packaged builds check for updates; in development there is no update feed
 * and no installed app to replace.
 */
export function initAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
  target: IpcMain = ipcMain
): void {
  getWindow = getMainWindow

  target.removeHandler(UPDATER_CHANNELS.getState)
  target.removeHandler(UPDATER_CHANNELS.download)
  target.removeHandler(UPDATER_CHANNELS.install)

  target.handle(UPDATER_CHANNELS.getState, () => state)
  target.handle(UPDATER_CHANNELS.download, () => {
    if (state.status !== 'available') return
    setState({ status: 'downloading', percent: 0 })
    void autoUpdater.downloadUpdate().catch((error) => {
      log.error('downloadUpdate threw', error)
      setState({ status: 'error' })
    })
  })
  target.handle(UPDATER_CHANNELS.install, () => {
    if (state.status !== 'downloaded') return
    autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) {
    log.info('skipping auto-update check: app is not packaged')
    return
  }

  if (process.platform === 'darwin') {
    log.info('skipping auto-update on macOS: build is unsigned')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error) => {
    log.error('auto-update failed', error)
    setState({ status: 'error' })
  })
  autoUpdater.on('update-available', (info) => {
    log.info('update available', { version: info.version })
    setState({ status: 'available', version: info.version, percent: 0 })
  })
  autoUpdater.on('update-not-available', () => {
    log.info('no update available')
    setState({ status: 'idle', version: null, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) => {
    setState({ status: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('update downloaded; ready to install', { version: info.version })
    setState({ status: 'downloaded', version: info.version, percent: 100 })
  })

  void autoUpdater.checkForUpdates().catch((error) => {
    log.error('checkForUpdates threw', error)
    setState({ status: 'error' })
  })
}
