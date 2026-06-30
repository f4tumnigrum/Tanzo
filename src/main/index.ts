import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import fixPath from 'fix-path'
import { createLogger, initializeLogger } from './logger'
import { createDatabaseModule, type DatabaseModule } from './database/module'
import { tanzoMigrations } from './database/schema'
import { createMcpModule, type McpModule } from './mcp/module'
import { createProviderModule, type ProviderModule } from './provider/module'
import { createAgentModule, type AgentModule } from './agent/module'
import { createSlashCommandModule, type SlashCommandModule } from './slash-command/module'
import { createFileMentionModule, type FileMentionModule } from './file-mention/module'
import { createPetAssetsModule, type PetAssetsModule } from './pet/module'
import {
  initPreferences,
  getPreferences,
  onPreferencesChanged,
  registerPreferencesIpc
} from './preferences'
import { broadcastSystemPreferences, registerSystemIpc } from './system'
import {
  registerWallpaperIpc,
  registerWallpaperProtocol,
  registerWallpaperScheme
} from './wallpaper'
import { createWindow } from './window'
import {
  createPetWindow,
  destroyPetWindow,
  registerPetWindowIpc,
  resizePetWindow
} from './pet-window'

fixPath()

registerWallpaperScheme()

initializeLogger()
const log = createLogger('main')
const startupStartedAt = Date.now()
let startupPreviousAt = startupStartedAt

function markStartup(step: string, extra: Record<string, unknown> = {}): void {
  const now = Date.now()
  log.info('startup step', {
    step,
    durationMs: now - startupPreviousAt,
    totalMs: now - startupStartedAt,
    ...extra
  })
  startupPreviousAt = now
}

let mainWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null
let petAssetsModule: PetAssetsModule | null = null
let databaseModule: DatabaseModule | null = null
let mcpModule: McpModule | null = null
let providerModule: ProviderModule | null = null
let agentModule: AgentModule | null = null
let slashCommandModule: SlashCommandModule | null = null
let fileMentionModule: FileMentionModule | null = null
let isQuitting = false
let devParentWatcher: NodeJS.Timeout | null = null
let syncPetWindow = (): void => {}

function quitFromDevLifecycle(reason: string): void {
  if (isQuitting) return
  log.info(reason)
  app.quit()
}

function installDevProcessLifecycle(): void {
  if (!is.dev) return

  const parentPid = process.ppid
  devParentWatcher = setInterval(() => {
    if (process.ppid !== parentPid) {
      quitFromDevLifecycle('Dev parent process changed; quitting Electron app')
      return
    }

    try {
      process.kill(parentPid, 0)
    } catch {
      quitFromDevLifecycle('Dev parent process exited; quitting Electron app')
    }
  }, 1000)
  devParentWatcher.unref()

  app.once('will-quit', () => {
    if (!devParentWatcher) return
    clearInterval(devParentWatcher)
    devParentWatcher = null
  })

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => quitFromDevLifecycle(`Received ${signal}; quitting Electron app`))
  }
}

function defaultWorkspaceRoot(): string {
  const cwd = process.cwd()
  if (cwd && cwd !== app.getPath('home')) return cwd
  return app.getPath('documents') || app.getPath('home')
}

function ensureMacDockIcon(): void {
  if (isQuitting || process.platform !== 'darwin') return
  app.setActivationPolicy('regular')
  app.dock?.show()
}

function attachMainWindowLifecycle(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (process.platform !== 'darwin' || isQuitting) return
    event.preventDefault()
    ensureMacDockIcon()
    window.hide()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    if (petWindow && !petWindow.isDestroyed()) destroyPetWindow(petWindow)
    petWindow = null
  })
}

function showMainWindow(): void {
  if (!app.isReady()) {
    app.once('ready', showMainWindow)
    return
  }
  ensureMacDockIcon()
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    markStartup('mainWindow.created')
    mainWindow.webContents.once('did-finish-load', () => markStartup('mainWindow.did-finish-load'))
    mainWindow.once('ready-to-show', () => markStartup('mainWindow.ready-to-show'))
    attachMainWindowLifecycle(mainWindow)
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  syncPetWindow()
}

const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  log.info('Another Tanzo instance is already running; exiting duplicate process')
  app.exit(0)
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

if (singleInstanceLock)
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    markStartup('menu')
    electronApp.setAppUserModelId('com.luminstudio.tanzo')
    markStartup('appUserModelId')
    ensureMacDockIcon()
    markStartup('dockIcon')
    installDevProcessLifecycle()
    markStartup('devLifecycle')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    initPreferences()
    markStartup('preferences.init')
    registerPreferencesIpc()
    registerSystemIpc(() => mainWindow)
    registerWallpaperProtocol()
    registerWallpaperIpc(() => mainWindow)
    nativeTheme.on('updated', broadcastSystemPreferences)
    markStartup('ipc.system')

    databaseModule = createDatabaseModule({
      userDataPath: app.getPath('userData'),
      migrations: [tanzoMigrations]
    })
    markStartup('database.module')

    mcpModule = createMcpModule({
      db: databaseModule.db,
      getWindows: () => BrowserWindow.getAllWindows()
    })
    mcpModule.registerIpc(ipcMain)
    markStartup('mcp.module')

    providerModule = createProviderModule({
      db: databaseModule.db
    })
    providerModule.registerIpc(ipcMain)
    markStartup('provider.module')

    agentModule = createAgentModule({
      db: databaseModule.db,
      providerService: providerModule.service,
      mcpService: mcpModule.service,
      workspaceRoot: defaultWorkspaceRoot(),
      getWindows: () => BrowserWindow.getAllWindows(),
      getChatWindows: () => (mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : []),
      disabledTools: () => getPreferences().disabledTools
    })
    agentModule.registerIpc(ipcMain)
    markStartup('agent.module')

    slashCommandModule = createSlashCommandModule({ skills: agentModule.skills })
    slashCommandModule.registerIpc(ipcMain)
    markStartup('slashCommand.module')

    fileMentionModule = createFileMentionModule()
    fileMentionModule.registerIpc(ipcMain)
    markStartup('fileMention.module')

    petAssetsModule = createPetAssetsModule()
    petAssetsModule.registerIpc(ipcMain)
    markStartup('petAssets.module')

    registerPetWindowIpc({
      getPet: () => petWindow,
      showMainWindow,
      setActiveChatId: (chatId) => agentModule?.presence.setActiveChatId(chatId)
    })
    markStartup('petWindow.ipc')

    showMainWindow()
    markStartup('showMainWindow.called')

    syncPetWindow = (): void => {
      ensureMacDockIcon()
      const enabled = getPreferences().petEnabled
      if (enabled && !petWindow) {
        const agent = agentModule
        if (!agent) return
        petWindow = createPetWindow({ getPresence: () => agent.presence.snapshot() })
        markStartup('petWindow.created')
        petWindow.once('ready-to-show', () => markStartup('petWindow.ready-to-show'))
        petWindow.webContents.once('did-finish-load', () =>
          markStartup('petWindow.did-finish-load')
        )
        petWindow.on('closed', () => {
          petWindow = null
        })
      } else if (!enabled && petWindow) {
        destroyPetWindow(petWindow)
        petWindow = null
      } else if (enabled && petWindow) {
        resizePetWindow(petWindow)
      }
    }

    syncPetWindow()
    markStartup('syncPetWindow')
    onPreferencesChanged(() => syncPetWindow())

    void mcpModule
      .initialize()
      .then(() => markStartup('mcp.initialize'))
      .catch((error) => {
        log.error('Failed to initialize MCP module', error)
      })

    app.on('activate', () => {
      showMainWindow()
    })
  })

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true

  void (async () => {
    if (petWindow && !petWindow.isDestroyed()) destroyPetWindow(petWindow)
    petWindow = null
    slashCommandModule?.close()
    fileMentionModule?.close()
    await agentModule?.close()
    await mcpModule?.close()
    providerModule?.close()
    databaseModule?.close()
    app.exit(0)
  })().catch((error) => {
    log.error('Failed to close modules before quit', error)
    app.exit(1)
  })
})

app.on('window-all-closed', () => {
  if (isQuitting) return
  if (process.platform !== 'darwin') app.quit()
  else ensureMacDockIcon()
})
