import type {
  CodexImportApi,
  CodexImportPreview,
  CodexImportRequest,
  CodexImportResult,
  CodexImportScanResult
} from '@shared/codex-import'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

function requireCodexImportApi(): CodexImportApi {
  const api = window.electron?.codexImport
  if (!api) {
    throw new TanzoIntegrationError(
      'ELECTRON_CODEX_IMPORT_API_UNAVAILABLE',
      'Electron Codex import API is not available'
    )
  }
  return withDecodedIpcErrors(api)
}

export const codexImportClient = {
  scanDefault(): Promise<CodexImportScanResult> {
    return requireCodexImportApi().scanDefault()
  },
  scanDirectory(path: string): Promise<CodexImportScanResult> {
    return requireCodexImportApi().scanDirectory(path)
  },
  previewSession(path: string): Promise<CodexImportPreview> {
    return requireCodexImportApi().previewSession(path)
  },
  importSessions(input: CodexImportRequest): Promise<CodexImportResult> {
    return requireCodexImportApi().importSessions(input)
  }
}
