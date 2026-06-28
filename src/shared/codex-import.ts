import type { TanzoUIMessage } from './agent-message'
import type { ConversationSummary } from './chat'

export interface ImportedConversationInput {
  source: 'codex'
  externalId: string
  sourcePath?: string
  sourceHash?: string
  title?: string
  cwd?: string
  modelRef?: string
  createdAt?: number
  updatedAt?: number
  messages: TanzoUIMessage[]
  contextTailMessages?: number
}

export interface ImportedConversationRecord {
  source: string
  externalId: string
  conversationId: string
  importedAt: number
  sourcePath: string | null
  sourceHash: string | null
}

export interface CodexImportSessionSummary {
  sessionId: string
  title: string
  sourcePath: string
  relativePath: string
  createdAt: number
  updatedAt: number
  bytes: number
  indexed: boolean
  importedConversationId: string | null
}

export interface CodexImportScanResult {
  rootPath: string
  sessions: CodexImportSessionSummary[]
  indexEntries: number
  filesScanned: number
  warnings: string[]
}

export interface CodexImportPreview {
  session: CodexImportSessionSummary
  messageCount: number
  userMessages: number
  assistantMessages: number
  toolCalls: number
  skippedRecords: number
  truncatedRecords: number
  parseErrors: number
  sample: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>
  warnings: string[]
}

export interface CodexImportOptions {
  includeToolSummaries?: boolean
  maxToolOutputChars?: number
  contextTailMessages?: number
  duplicateMode?: 'skip' | 'copy'
}

export interface CodexImportRequest {
  sessionPaths: string[]
  options?: CodexImportOptions
}

export interface CodexImportItemResult {
  sessionId: string
  sourcePath: string
  status: 'imported' | 'skipped' | 'failed'
  conversation?: ConversationSummary
  reason?: string
}

export interface CodexImportResult {
  imported: number
  skipped: number
  failed: number
  results: CodexImportItemResult[]
}

export const CODEX_IMPORT_CHANNELS = {
  scanDefault: 'codex-import:scan-default',
  scanDirectory: 'codex-import:scan-directory',
  previewSession: 'codex-import:preview-session',
  importSessions: 'codex-import:import-sessions'
} as const

export interface CodexImportApi {
  scanDefault(): Promise<CodexImportScanResult>
  scanDirectory(path: string): Promise<CodexImportScanResult>
  previewSession(path: string): Promise<CodexImportPreview>
  importSessions(input: CodexImportRequest): Promise<CodexImportResult>
}
