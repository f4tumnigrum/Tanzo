import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type {
  CodexImportOptions,
  CodexImportPreview,
  CodexImportRequest,
  CodexImportResult,
  CodexImportScanResult,
  CodexImportSessionSummary
} from '@shared/codex-import'
import type { TanzoUIMessage } from '@shared/agent-message'
import { TanzoValidationError } from '@shared/errors'
import type { AgentStore } from '../agent/store-types'

const CODEX_SOURCE = 'codex'
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 50_000
const DEFAULT_CONTEXT_TAIL_MESSAGES = 12
const PREVIEW_TEXT_LIMIT = 700
const TITLE_LIMIT = 80
const MAX_IMPORT_SESSIONS = 200

interface LoggerLike {
  warn(message: string, meta?: Record<string, unknown>): void
}

interface SessionIndexEntry {
  id: string
  thread_name?: string
  updated_at?: string | number
}

interface ParsedRecord {
  timestamp: number
  type: string
  payload: Record<string, unknown>
}

interface ParsedConversation {
  sessionId: string
  title: string
  cwd?: string
  createdAt: number
  updatedAt: number
  messages: TanzoUIMessage[]
  userMessages: number
  assistantMessages: number
  toolCalls: number
  skippedRecords: number
  truncatedRecords: number
  parseErrors: number
  sample: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>
  warnings: string[]
}

export interface CodexImportService {
  scanDefault(): Promise<CodexImportScanResult>
  scanDirectory(path: string): Promise<CodexImportScanResult>
  previewSession(path: string): Promise<CodexImportPreview>
  importSessions(input: CodexImportRequest): Promise<CodexImportResult>
}

export function defaultCodexRoot(): string {
  return join(homedir(), '.codex')
}

export function createCodexImportService(deps: {
  store: AgentStore
  logger: LoggerLike
}): CodexImportService {
  async function scanDefault(): Promise<CodexImportScanResult> {
    return scanDirectory(defaultCodexRoot())
  }

  async function scanDirectory(inputPath: string): Promise<CodexImportScanResult> {
    const rootPath = resolve(inputPath)
    const rootStat = await stat(rootPath).catch(() => null)
    if (!rootStat?.isDirectory()) {
      throw new TanzoValidationError(
        'CODEX_IMPORT_ROOT_INVALID',
        `Codex import root must be an existing directory: ${inputPath}`
      )
    }

    const index = await readSessionIndex(rootPath)
    const sessionRoot = join(rootPath, 'sessions')
    const files = await findJsonlFiles(sessionRoot).catch(() => [])
    const imported = new Map(
      deps.store
        .listImportedConversations(CODEX_SOURCE)
        .map((record) => [record.externalId, record.conversationId] as const)
    )
    const sessions: CodexImportSessionSummary[] = []
    const warnings: string[] = []

    for (const file of files) {
      const summary = await summarizeSessionFile(rootPath, file, index, imported)
      if (summary) sessions.push(summary)
    }

    const indexedWithoutFile = [...index.keys()].filter(
      (id) => !sessions.some((session) => session.sessionId === id)
    ).length
    if (indexedWithoutFile > 0) {
      warnings.push(`${indexedWithoutFile} indexed Codex sessions did not have a matching JSONL file.`)
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      rootPath,
      sessions,
      indexEntries: index.size,
      filesScanned: files.length,
      warnings
    }
  }

  async function previewSession(path: string): Promise<CodexImportPreview> {
    const sourcePath = resolve(path)
    const rootPath = inferCodexRoot(sourcePath)
    const index = await readSessionIndex(rootPath)
    const imported = new Map(
      deps.store
        .listImportedConversations(CODEX_SOURCE)
        .map((record) => [record.externalId, record.conversationId] as const)
    )
    const session = await summarizeSessionFile(rootPath, sourcePath, index, imported)
    if (!session) {
      throw new TanzoValidationError('CODEX_IMPORT_SESSION_INVALID', `Invalid Codex session: ${path}`)
    }
    const parsed = await parseSessionFile(sourcePath, { includeToolSummaries: false })
    return {
      session,
      messageCount: parsed.messages.length,
      userMessages: parsed.userMessages,
      assistantMessages: parsed.assistantMessages,
      toolCalls: parsed.toolCalls,
      skippedRecords: parsed.skippedRecords,
      truncatedRecords: parsed.truncatedRecords,
      parseErrors: parsed.parseErrors,
      sample: parsed.sample,
      warnings: parsed.warnings
    }
  }

  async function importSessions(input: CodexImportRequest): Promise<CodexImportResult> {
    const paths = [...new Set(input.sessionPaths.map((path) => resolve(path)))]
    if (paths.length > MAX_IMPORT_SESSIONS) {
      throw new TanzoValidationError(
        'CODEX_IMPORT_TOO_MANY_SESSIONS',
        `Cannot import more than ${MAX_IMPORT_SESSIONS} sessions at once.`
      )
    }
    const options = normalizeOptions(input.options)
    const results: CodexImportResult['results'] = []

    for (const sourcePath of paths) {
      try {
        const parsed = await parseSessionFile(sourcePath, options)
        const existing = deps.store.getImportedConversation(CODEX_SOURCE, parsed.sessionId)
        if (existing && options.duplicateMode !== 'copy') {
          results.push({
            sessionId: parsed.sessionId,
            sourcePath,
            status: 'skipped',
            reason: 'already imported'
          })
          continue
        }
        if (parsed.messages.length === 0) {
          results.push({
            sessionId: parsed.sessionId,
            sourcePath,
            status: 'failed',
            reason: 'no importable messages'
          })
          continue
        }

        const sourceHash = await hashFile(sourcePath)
        const externalId =
          options.duplicateMode === 'copy' && existing
            ? `${parsed.sessionId}:${randomUUID()}`
            : parsed.sessionId
        const conversation = deps.store.importConversation({
          source: CODEX_SOURCE,
          externalId,
          sourcePath,
          sourceHash,
          title: parsed.title,
          cwd: parsed.cwd,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
          messages: parsed.messages,
          contextTailMessages: options.contextTailMessages
        })
        results.push({ sessionId: parsed.sessionId, sourcePath, status: 'imported', conversation })
      } catch (error) {
        deps.logger.warn('failed to import Codex session', { sourcePath, error })
        results.push({
          sessionId: sessionIdFromPath(sourcePath),
          sourcePath,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      imported: results.filter((result) => result.status === 'imported').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      failed: results.filter((result) => result.status === 'failed').length,
      results
    }
  }

  return { scanDefault, scanDirectory, previewSession, importSessions }
}

function normalizeOptions(options: CodexImportOptions | undefined): Required<CodexImportOptions> {
  return {
    includeToolSummaries: options?.includeToolSummaries ?? false,
    maxToolOutputChars: options?.maxToolOutputChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS,
    contextTailMessages: options?.contextTailMessages ?? DEFAULT_CONTEXT_TAIL_MESSAGES,
    duplicateMode: options?.duplicateMode ?? 'skip'
  }
}

async function readSessionIndex(rootPath: string): Promise<Map<string, SessionIndexEntry>> {
  const indexPath = join(rootPath, 'session_index.jsonl')
  const text = await readFile(indexPath, 'utf8').catch(() => '')
  const index = new Map<string, SessionIndexEntry>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as SessionIndexEntry
      if (entry.id) index.set(entry.id, entry)
    } catch {
      // Ignore corrupt index rows; session files remain the source of truth.
    }
  }
  return index
}

async function findJsonlFiles(rootPath: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(fullPath)
      }
    }
  }
  await walk(rootPath)
  return out
}

async function summarizeSessionFile(
  rootPath: string,
  sourcePath: string,
  index: Map<string, SessionIndexEntry>,
  imported: Map<string, string>
): Promise<CodexImportSessionSummary | null> {
  const fileStat = await stat(sourcePath).catch(() => null)
  if (!fileStat?.isFile()) return null
  const meta = await readSessionMeta(sourcePath)
  const sessionId = meta.sessionId || sessionIdFromPath(sourcePath)
  const indexEntry = index.get(sessionId)
  const title = cleanTitle(indexEntry?.thread_name) || cleanTitle(meta.title) || basename(sourcePath)
  const indexedUpdatedAt = parseTimestamp(indexEntry?.updated_at)
  const createdAt = meta.createdAt || fileStat.birthtimeMs || fileStat.ctimeMs
  const updatedAt = indexedUpdatedAt || meta.updatedAt || fileStat.mtimeMs
  return {
    sessionId,
    title,
    sourcePath,
    relativePath: relative(rootPath, sourcePath),
    createdAt,
    updatedAt,
    bytes: fileStat.size,
    indexed: Boolean(indexEntry),
    importedConversationId: imported.get(sessionId) ?? null
  }
}

async function readSessionMeta(sourcePath: string): Promise<{
  sessionId?: string
  title?: string
  cwd?: string
  createdAt?: number
  updatedAt?: number
}> {
  for await (const line of readJsonlLines(sourcePath, 30)) {
    try {
      const record = JSON.parse(line) as ParsedRecord
      if (record.type !== 'session_meta') continue
      const payload = record.payload as Record<string, unknown>
      return {
        sessionId: stringValue(payload.session_id) || stringValue(payload.id),
        cwd: stringValue(payload.cwd),
        createdAt: parseTimestamp(payload.timestamp) || parseTimestamp(record.timestamp),
        updatedAt: parseTimestamp(record.timestamp)
      }
    } catch {
      return {}
    }
  }
  return {}
}

async function parseSessionFile(
  sourcePath: string,
  options: Partial<Required<CodexImportOptions>>
): Promise<ParsedConversation> {
  const normalized = normalizeOptions(options)
  let sessionId = sessionIdFromPath(sourcePath)
  let cwd: string | undefined
  let title = basename(sourcePath)
  let createdAt = Date.now()
  let updatedAt = createdAt
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let skippedRecords = 0
  let truncatedRecords = 0
  let parseErrors = 0
  const warnings: string[] = []
  const sample: ParsedConversation['sample'] = []
  const messages: TanzoUIMessage[] = []
  const pendingToolCalls = new Map<string, { name: string; argumentsText: string; timestamp: number }>()

  for await (const line of readJsonlLines(sourcePath)) {
    let record: ParsedRecord
    try {
      record = JSON.parse(line) as ParsedRecord
    } catch {
      parseErrors += 1
      continue
    }
    const timestamp = parseTimestamp(record.timestamp) || updatedAt
    updatedAt = Math.max(updatedAt, timestamp)

    if (record.type === 'session_meta') {
      const payload = objectValue(record.payload)
      sessionId = stringValue(payload.session_id) || stringValue(payload.id) || sessionId
      cwd = stringValue(payload.cwd) || cwd
      const metaTime = parseTimestamp(payload.timestamp)
      if (metaTime) createdAt = metaTime
      continue
    }

    if (record.type !== 'response_item' && record.type !== 'event_msg') {
      skippedRecords += 1
      continue
    }

    const payload = objectValue(record.payload)
    const payloadType = stringValue(payload.type)
    if (payloadType === 'message') {
      const role = stringValue(payload.role)
      if (role !== 'user' && role !== 'assistant') {
        skippedRecords += 1
        continue
      }
      const text = textFromContent(payload.content)
      if (!text.trim()) {
        skippedRecords += 1
        continue
      }
      addTextMessage(messages, role, text, timestamp)
      if (role === 'user') userMessages += 1
      else assistantMessages += 1
      addSample(sample, role, text, timestamp)
      if (role === 'user' && title === basename(sourcePath)) title = cleanTitle(text)
      continue
    }

    if (payloadType === 'user_message') {
      const text = stringValue(payload.message)
      if (!text.trim()) {
        skippedRecords += 1
        continue
      }
      if (!hasRecentDuplicate(messages, 'user', text)) {
        addTextMessage(messages, 'user', text, timestamp)
        userMessages += 1
        addSample(sample, 'user', text, timestamp)
        if (title === basename(sourcePath)) title = cleanTitle(text)
      }
      continue
    }

    if (payloadType === 'agent_message') {
      const text = stringValue(payload.message)
      if (!text.trim()) {
        skippedRecords += 1
        continue
      }
      if (!hasRecentDuplicate(messages, 'assistant', text)) {
        addTextMessage(messages, 'assistant', text, timestamp)
        assistantMessages += 1
        addSample(sample, 'assistant', text, timestamp)
      }
      continue
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      toolCalls += 1
      if (!normalized.includeToolSummaries) continue
      const callId = stringValue(payload.call_id) || stringValue(payload.id) || randomUUID()
      pendingToolCalls.set(callId, {
        name: stringValue(payload.name) || payloadType,
        argumentsText: stringifyForDisplay(payload.arguments),
        timestamp
      })
      continue
    }

    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      if (!normalized.includeToolSummaries) continue
      const callId = stringValue(payload.call_id)
      const call = callId ? pendingToolCalls.get(callId) : undefined
      let output = stringifyForDisplay(payload.output)
      if (output.length > normalized.maxToolOutputChars) {
        output = `${output.slice(0, normalized.maxToolOutputChars)}\n\n[omitted ${output.length - normalized.maxToolOutputChars} chars from Codex tool output]`
        truncatedRecords += 1
      }
      const name = call?.name ?? 'tool'
      const args = call?.argumentsText ? `\narguments:\n${call.argumentsText}` : ''
      addTextMessage(messages, 'assistant', `[Codex tool: ${name}]${args}\noutput:\n${output}`, timestamp)
      assistantMessages += 1
      if (callId) pendingToolCalls.delete(callId)
      continue
    }

    if (payloadType === 'reasoning') {
      skippedRecords += 1
      continue
    }

    skippedRecords += 1
  }

  if (parseErrors > 0) warnings.push(`${parseErrors} invalid JSONL records were skipped.`)
  if (truncatedRecords > 0) warnings.push(`${truncatedRecords} large tool outputs were truncated.`)

  return {
    sessionId,
    title: cleanTitle(title) || sessionId,
    cwd,
    createdAt,
    updatedAt,
    messages,
    userMessages,
    assistantMessages,
    toolCalls,
    skippedRecords,
    truncatedRecords,
    parseErrors,
    sample,
    warnings
  }
}

async function* readJsonlLines(sourcePath: string, limit?: number): AsyncGenerator<string> {
  const stream = createReadStream(sourcePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let count = 0
  for await (const line of rl) {
    if (line.trim()) yield line
    count += 1
    if (limit && count >= limit) break
  }
  rl.close()
  stream.destroy()
}

function addTextMessage(
  messages: TanzoUIMessage[],
  role: 'user' | 'assistant',
  text: string,
  timestamp: number
): void {
  messages.push({
    id: randomUUID(),
    role,
    parts: [{ type: 'text', text }],
    metadata: { createdAt: timestamp }
  } as TanzoUIMessage)
}

function addSample(
  sample: ParsedConversation['sample'],
  role: 'user' | 'assistant',
  text: string,
  timestamp: number
): void {
  if (sample.length >= 6) return
  sample.push({ role, text: text.slice(0, PREVIEW_TEXT_LIMIT), timestamp })
}

function hasRecentDuplicate(messages: TanzoUIMessage[], role: 'user' | 'assistant', text: string): boolean {
  const last = messages.at(-1)
  if (!last || last.role !== role) return false
  const lastText = last.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  return lastText.trim() === text.trim()
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const obj = objectValue(part)
      const type = stringValue(obj.type)
      if (type === 'input_text' || type === 'output_text' || type === 'text') {
        return stringValue(obj.text)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function cleanTitle(value: unknown): string {
  const text = stringValue(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}...` : text
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function sessionIdFromPath(sourcePath: string): string {
  const name = basename(sourcePath).replace(/\.jsonl$/i, '')
  const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  return match?.[1] ?? name
}

function inferCodexRoot(sourcePath: string): string {
  let dir = dirname(resolve(sourcePath))
  while (basename(dir).match(/^\d{2}$/) || basename(dir).match(/^\d{4}$/)) dir = dirname(dir)
  if (basename(dir) === 'sessions') return dirname(dir)
  return defaultCodexRoot()
}

async function hashFile(sourcePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(sourcePath)) hash.update(chunk)
  return hash.digest('hex')
}
