import { vi } from 'vitest'

function createScopedLogger(): Record<string, unknown> {
  const logger: Record<string, unknown> = {}
  for (const level of ['error', 'warn', 'info', 'verbose', 'debug', 'silly', 'log']) {
    logger[level] = vi.fn()
  }
  logger.scope = vi.fn(() => logger)
  return logger
}

function createElectronLog(): Record<string, unknown> {
  const root = createScopedLogger()
  return {
    ...root,
    initialize: vi.fn(),
    scope: vi.fn(() => createScopedLogger()),
    hooks: { push: vi.fn() },
    errorHandler: { startCatching: vi.fn() },
    transports: {
      file: { level: 'info', maxSize: 0, format: '', fileName: '' },
      console: { level: 'info', format: '', useStyles: false }
    }
  }
}

const electronLog = createElectronLog()

vi.mock('electron-log/main', () => ({ default: electronLog }))
vi.mock('electron-log/preload', () => ({ default: electronLog }))
vi.mock('electron-log/renderer', () => ({ default: electronLog }))

vi.mock('electron', () => {
  const noop = vi.fn()
  return {
    app: {
      getPath: vi.fn(() => ''),
      getAppPath: vi.fn(() => ''),
      getLocale: vi.fn(() => 'en-US'),
      getPreferredSystemLanguages: vi.fn(() => ['en-US']),
      isPackaged: false,
      isReady: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
      requestSingleInstanceLock: vi.fn(() => true),
      setActivationPolicy: noop,
      getVersion: vi.fn(() => '0.0.0-test'),
      on: noop,
      once: noop,
      quit: noop,
      exit: noop,
      dock: { setIcon: noop, show: noop, hide: noop }
    },
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: noop, removeAllListeners: noop },
    ipcRenderer: { invoke: vi.fn(), send: noop, on: noop, removeListener: noop },
    contextBridge: { exposeInMainWorld: noop },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn(() => Buffer.from('')),
      decryptString: vi.fn(() => '')
    },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, on: noop },
    BrowserWindow: Object.assign(
      vi.fn(() => ({ on: noop, webContents: { send: noop } })),
      { getAllWindows: vi.fn(() => []) }
    ),
    Menu: { setApplicationMenu: noop, buildFromTemplate: vi.fn(() => ({})) },
    dialog: { showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })) },
    shell: { openExternal: vi.fn(() => Promise.resolve()) },
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 0, height: 0 } })),
      getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 0, height: 0 } }))
    },
    net: { fetch: vi.fn(() => Promise.resolve(new Response(null))) },
    protocol: { handle: noop, registerSchemesAsPrivileged: noop }
  }
})
