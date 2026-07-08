import { randomUUID } from 'crypto'
import type { IpcMain } from 'electron'
import {
  MCP_CHANNELS,
  BUILTIN_BROWSER_SERVER_NAME,
  type McpConnectionState,
  type McpElicitResult,
  type McpServerConfig
} from '@shared/mcp'
import type { SqlDatabase } from '../database/types'
import { McpClient } from './client'
import { registerMcpIpc } from './ipc'
import { createMcpService, type McpService } from './service'
import { createLogger } from '../logger'
import { createMcpStore, type McpStore } from './store'

const log = createLogger('mcp.module')

interface WebContentsLike {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

interface BrowserWindowLike {
  isDestroyed(): boolean
  webContents: WebContentsLike
}

export interface CreateMcpModuleOptions {
  db: SqlDatabase
  getWindows(): BrowserWindowLike[]
  elicitationTimeoutMs?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  enableReconnect?: boolean
  maxToolRetries?: number
  appName?: string
  appVersion?: string

  remoteDebuggingPort?: number

  browserAutomationEnabled?: () => boolean
}

export { BUILTIN_BROWSER_SERVER_NAME }

export const BUILTIN_BROWSER_SERVER_ID = 'builtin:chrome-devtools'

function buildBrowserServerConfig(port: number, enabled: boolean): McpServerConfig {
  return {
    id: BUILTIN_BROWSER_SERVER_ID,
    name: BUILTIN_BROWSER_SERVER_NAME,
    description: 'Built-in browser automation (drives the embedded browser via CDP).',
    transport: 'stdio',
    command: 'npx',
    args: [
      '-y',
      'chrome-devtools-mcp@latest',
      '--browserUrl',
      `http://127.0.0.1:${port}`,
      '--experimentalIncludeAllPages',
      '--blockedUrlPattern',
      'file://**'
    ],
    enabled,
    builtin: true
  }
}

export interface McpModule {
  service: McpService
  initialize(): Promise<void>
  registerIpc(ipcMain: IpcMain): void
  close(): Promise<void>
}

const DEFAULT_ELICITATION_TIMEOUT_MS = 5 * 60_000

function isUsableWindow(window: BrowserWindowLike): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed()
}

export function createMcpModule(options: CreateMcpModuleOptions): McpModule {
  const pendingElicitations = new Map<string, (result: McpElicitResult) => void>()
  const elicitationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const elicitationTimeoutMs = options.elicitationTimeoutMs ?? DEFAULT_ELICITATION_TIMEOUT_MS
  let unregisterIpc: (() => void) | null = null
  let unsubscribeStates: (() => void) | null = null

  function broadcastAll(channel: string, payload: unknown): void {
    for (const window of options.getWindows()) {
      if (!isUsableWindow(window)) continue
      window.webContents.send(channel, payload)
    }
  }

  function sendToPrimary(channel: string, payload: unknown): boolean {
    const target = options.getWindows().find(isUsableWindow)
    if (!target) return false
    target.webContents.send(channel, payload)
    return true
  }

  function clearElicitation(requestId: string): void {
    const timer = elicitationTimers.get(requestId)
    if (timer) clearTimeout(timer)
    elicitationTimers.delete(requestId)
    pendingElicitations.delete(requestId)
  }

  const client = new McpClient({
    ...(options.appName ? { appName: options.appName } : {}),
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    ...(options.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: options.connectTimeoutMs }
      : {}),
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {}),
    ...(options.enableReconnect !== undefined ? { enableReconnect: options.enableReconnect } : {}),
    ...(options.maxToolRetries !== undefined ? { maxToolRetries: options.maxToolRetries } : {}),
    handleElicitationRequest: async (request) => {
      const requestId = randomUUID()

      return await new Promise<McpElicitResult>((resolve) => {
        pendingElicitations.set(requestId, resolve)
        const sent = sendToPrimary(MCP_CHANNELS.elicitationRequested, {
          requestId,
          serverName: request.serverName,
          message: request.message,
          requestedSchema: request.requestedSchema
        })
        if (!sent) {
          pendingElicitations.delete(requestId)
          resolve({ action: 'cancel' })
          return
        }
        const timer = setTimeout(() => {
          if (!pendingElicitations.has(requestId)) return
          clearElicitation(requestId)
          resolve({ action: 'cancel' })
        }, elicitationTimeoutMs)
        elicitationTimers.set(requestId, timer)
      })
    }
  })
  const store: McpStore = createMcpStore(options.db)
  const service = createMcpService(store, client)
  log.info('initialized')

  function resolveElicitation(requestId: string, result: McpElicitResult): void {
    const resolver = pendingElicitations.get(requestId)
    if (!resolver) return
    clearElicitation(requestId)
    resolver(result)
  }

  const browserPort = options.remoteDebuggingPort ?? 0
  if (browserPort > 0) {
    service.setBuiltinServers(() => [
      buildBrowserServerConfig(browserPort, options.browserAutomationEnabled?.() ?? true)
    ])
    log.info('registered built-in browser server', { port: browserPort })
  }

  return {
    service,
    async initialize() {
      await service.syncFromStore()
      unsubscribeStates = service.onConnectionStatesChanged((states: McpConnectionState[]) => {
        broadcastAll(MCP_CHANNELS.connectionStatesChanged, [...states])
      })
    },
    registerIpc(ipcMain) {
      unregisterIpc?.()
      unregisterIpc = registerMcpIpc(ipcMain, service, { resolveElicitation })
    },
    async close() {
      unregisterIpc?.()
      unregisterIpc = null
      unsubscribeStates?.()
      unsubscribeStates = null
      for (const requestId of [...pendingElicitations.keys()]) {
        const resolver = pendingElicitations.get(requestId)
        clearElicitation(requestId)
        resolver?.({ action: 'cancel' })
      }
      await service.dispose()
      log.info('closed')
    }
  }
}
