import { app, ipcMain, type BrowserWindow, type IpcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UPDATER_CHANNELS, INITIAL_UPDATER_STATE, type UpdaterState } from '@shared/updater'
import { createLogger } from './logger'

const log = createLogger('updater')

let state: UpdaterState = { ...INITIAL_UPDATER_STATE }
let getWindow: () => BrowserWindow | null = () => null

let feedReady = false

function setState(next: Partial<UpdaterState>): void {
  state = { ...state, ...next }
  const window = getWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(UPDATER_CHANNELS.stateChanged, state)
}

function runCheck(): void {
  if (!feedReady) return
  setState({ status: 'checking' })
  void autoUpdater.checkForUpdates().catch((error) => {
    log.error('checkForUpdates threw', error)
    setState({ status: 'error' })
  })
}

export function initAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
  target: IpcMain = ipcMain
): void {
  getWindow = getMainWindow

  target.removeHandler(UPDATER_CHANNELS.getState)
  target.removeHandler(UPDATER_CHANNELS.check)
  target.removeHandler(UPDATER_CHANNELS.download)
  target.removeHandler(UPDATER_CHANNELS.install)

  target.handle(UPDATER_CHANNELS.getState, () => state)
  target.handle(UPDATER_CHANNELS.check, () => runCheck())
  target.handle(UPDATER_CHANNELS.download, () => {
    if (state.status !== 'available') return
    setState({ status: 'downloading', percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 })
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

  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin'

  autoUpdater.on('error', (error) => {
    log.error('auto-update failed', error)
    setState({ status: 'error' })
  })
  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' })
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
    setState({
      status: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond),
      transferred: progress.transferred,
      total: progress.total
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('update downloaded; ready to install', { version: info.version })
    setState({ status: 'downloaded', version: info.version, percent: 100, bytesPerSecond: 0 })
  })

  feedReady = true

  runCheck()
}
