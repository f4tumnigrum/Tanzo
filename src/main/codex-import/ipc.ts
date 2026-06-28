import type { IpcMain } from 'electron'
import { z } from 'zod'
import { CODEX_IMPORT_CHANNELS } from '@shared/codex-import'
import { registerIpcHandlers } from '../ipc/router'
import type { CodexImportService } from './service'

const pathSchema = z.string().trim().min(1)
const importOptionsSchema = z
  .object({
    includeToolSummaries: z.boolean().optional(),
    maxToolOutputChars: z.number().int().min(1000).max(500_000).optional(),
    contextTailMessages: z.number().int().min(0).max(100).optional(),
    duplicateMode: z.enum(['skip', 'copy']).optional()
  })
  .optional()

const importRequestSchema = z.object({
  sessionPaths: z.array(pathSchema).min(1).max(200),
  options: importOptionsSchema
})

export function registerCodexImportIpc(
  ipcMain: IpcMain,
  service: CodexImportService
): () => void {
  return registerIpcHandlers(ipcMain, [
    [CODEX_IMPORT_CHANNELS.scanDefault, () => service.scanDefault()],
    [CODEX_IMPORT_CHANNELS.scanDirectory, (path) => service.scanDirectory(pathSchema.parse(path))],
    [CODEX_IMPORT_CHANNELS.previewSession, (path) => service.previewSession(pathSchema.parse(path))],
    [CODEX_IMPORT_CHANNELS.importSessions, (input) => service.importSessions(importRequestSchema.parse(input))]
  ])
}
