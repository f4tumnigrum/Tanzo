import type { IpcMain } from 'electron'
import type { AgentStore } from '../agent/store-types'
import { createLogger } from '../logger'
import { createCodexImportService, type CodexImportService } from './service'
import { registerCodexImportIpc } from './ipc'

export interface CodexImportModule {
  service: CodexImportService
  registerIpc(ipcMain: IpcMain): void
  close(): void
}

export function createCodexImportModule(options: { store: AgentStore }): CodexImportModule {
  const logger = createLogger('codex-import')
  const service = createCodexImportService({ store: options.store, logger })
  let unregister: (() => void) | undefined

  return {
    service,
    registerIpc(ipcMain) {
      unregister?.()
      unregister = registerCodexImportIpc(ipcMain, service)
    },
    close() {
      unregister?.()
      unregister = undefined
    }
  }
}
