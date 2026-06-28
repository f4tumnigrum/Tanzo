import { CODEX_IMPORT_CHANNELS, type CodexImportApi } from '@shared/codex-import'
import { invoke } from './invoke'

export const codexImportApi: CodexImportApi = {
  scanDefault: invoke<CodexImportApi['scanDefault']>(CODEX_IMPORT_CHANNELS.scanDefault),
  scanDirectory: invoke<CodexImportApi['scanDirectory']>(CODEX_IMPORT_CHANNELS.scanDirectory),
  previewSession: invoke<CodexImportApi['previewSession']>(CODEX_IMPORT_CHANNELS.previewSession),
  importSessions: invoke<CodexImportApi['importSessions']>(CODEX_IMPORT_CHANNELS.importSessions)
}

export type CodexImportPreloadApi = typeof codexImportApi
