import { createHash, randomUUID } from 'crypto'
import { realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type {
  ConversationSummary,
  ForkConversationResult,
  NewConversationInput
} from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { ImportedConversationInput, ImportedConversationRecord } from '@shared/codex-import'
import { TanzoNotFoundError, TanzoValidationError } from '@shared/errors'
import type { SqlDatabase } from '../database/types'
import type { AgentDefinition } from './agents/types'
import type {
  PromptCacheDiagnosticFinish,
  PromptCacheDiagnosticRecord,
  PromptDiagnosticPrevious
} from './diagnostics/prompt-cache'
import { createConversationRepo } from './repositories/conversation-repo'
import { createMessageRepo } from './repositories/message-repo'
import { createPromptDiagnosticRepo } from './repositories/prompt-diagnostic-repo'
import { createQueuedMessageRepo } from './repositories/queued-message-repo'
import { createSubagentTaskRepo } from './repositories/subagent-task-repo'
import { createToolExecutionRepo } from './repositories/tool-execution-repo'
import { createActivityRepo } from './repositories/activity-repo'
import type { AgentIdentity } from './agents/types'
import type { Logger } from './logging'
import type { AgentStore } from './store-types'

const FINISHED_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied'])

export function createAgentStore(
  db: SqlDatabase,
  identity: AgentIdentity,
  logger: Logger,
  defaultCwd: string
): AgentStore {
  const conversations = createConversationRepo(db, defaultCwd)
  const messages = createMessageRepo(db, logger)
  const promptDiagnostics = createPromptDiagnosticRepo(db)
  const queuedMessages = createQueuedMessageRepo(db)
  const subagentTasks = createSubagentTaskRepo(db)
  const toolExecutions = createToolExecutionRepo(db)
  const activity = createActivityRepo(db)

  const selectImportedConversation = db.prepare(`
    SELECT source, external_id, conversation_id, imported_at, source_path, source_hash
    FROM imported_conversations
    WHERE source = ? AND external_id = ?
  `)
  const selectImportedConversations = db.prepare(`
    SELECT source, external_id, conversation_id, imported_at, source_path, source_hash
    FROM imported_conversations
    WHERE source = ?
  `)
  const insertImportedConversation = db.prepare(`
    INSERT INTO imported_conversations (
      source, external_id, conversation_id, imported_at, source_path, source_hash
    ) VALUES (
      @source, @external_id, @conversation_id, @imported_at, @source_path, @source_hash
    )
  `)

  interface ImportedConversationRow {
    source: string
    external_id: string
    conversation_id: string
    imported_at: number
    source_path: string | null
    source_hash: string | null
  }

  function importedRowToRecord(row: ImportedConversationRow): ImportedConversationRecord {
    return {
      source: row.source,
      externalId: row.external_id,
      conversationId: row.conversation_id,
      importedAt: row.imported_at,
      sourcePath: row.source_path,
      sourceHash: row.source_hash
    }
  }

  function normalizeCwd(cwd: string): string {
    const absolute = resolve(cwd)
    try {
      const real = realpathSync(absolute)
      if (!statSync(real).isDirectory()) {
        throw new TanzoValidationError(
          'AGENT_CWD_INVALID',
          `Conversation cwd must be an existing directory: ${cwd}`
        )
      }
      return real
    } catch (error) {
      if (error instanceof TanzoValidationError) throw error
      throw new TanzoValidationError(
        'AGENT_CWD_INVALID',
        `Conversation cwd must be an existing directory: ${cwd}`,
        { cause: error }
      )
    }
  }

  function normalizeAgentId(agentId: string | undefined): string {
    const id = (agentId ?? 'tanzo').trim()
    if (id && identity.resolveAgentType(id)) return id
    throw new TanzoNotFoundError(
      'AGENT_DEFINITION_NOT_FOUND',
      `Agent "${agentId ?? ''}" was not found.`
    )
  }

  function workspaceIdFromCwd(cwd: string): string {
    return `ws_${createHash('sha256').update(cwd).digest('hex').slice(0, 24)}`
  }

  function workspaceNameFromCwd(cwd: string): string {
    return basename(cwd) || cwd
  }

  function requireConversation(chatId: string, code: string): ConversationSummary {
    const conversation = conversations.get(chatId)
    if (conversation) return conversation
    throw new TanzoNotFoundError(code, `Conversation "${chatId}" was not found.`)
  }

  function isToolLikePart(part: TanzoUIMessage['parts'][number]): boolean {
    return (
      typeof part.type === 'string' &&
      (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
    )
  }

  function assertForkableTarget(message: TanzoUIMessage): void {
    if (message.role !== 'assistant') {
      throw new TanzoValidationError(
        'CHAT_FORK_INVALID_TARGET',
        'Conversation forks can only start from an assistant message.'
      )
    }

    for (const part of message.parts) {
      const state = 'state' in part ? String(part.state ?? '') : ''
      if (part.type === 'text' && state === 'streaming') {
        throw new TanzoValidationError(
          'CHAT_FORK_INCOMPLETE_TARGET',
          'Cannot fork from a message that is still streaming.'
        )
      }
      if (isToolLikePart(part) && !FINISHED_TOOL_STATES.has(state)) {
        throw new TanzoValidationError(
          'CHAT_FORK_INCOMPLETE_TARGET',
          'Cannot fork from a message with an unfinished tool call.'
        )
      }
    }
  }

  function titleFrom(messages: TanzoUIMessage[]): string {
    const firstUser = messages.find((message) => message.role === 'user')
    if (!firstUser) return ''

    const text = firstUser.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .trim()
      .replace(/\s+/g, ' ')

    if (!text) return ''
    return text.length > 60 ? `${text.slice(0, 59)}…` : text
  }

  function maybeSetInitialTitle(chatId: string, source: TanzoUIMessage[]): void {
    const conversation = conversations.get(chatId)
    if (!conversation || conversation.title.trim()) return

    const title = titleFrom(source)
    if (title) conversations.setTitle(chatId, title)
  }

  function touch(chatId: string): void {
    conversations.touch(chatId, Date.now())
  }

  function writeActiveMessages(chatId: string, nextMessages: TanzoUIMessage[]): void {
    messages.writeActive(chatId, nextMessages)
    maybeSetInitialTitle(chatId, nextMessages)
    touch(chatId)
  }

  function createConversation(input: NewConversationInput): ConversationSummary {
    const now = Date.now()
    const cwd = normalizeCwd(input.cwd ?? defaultCwd)
    const workspaceId = input.workspaceId?.trim() || workspaceIdFromCwd(cwd)
    const parentConversationId = input.parentConversationId ?? null
    const summary: ConversationSummary = {
      id: randomUUID(),
      title: input.title ?? '',
      agentId: normalizeAgentId(input.agentId),
      modelRef: input.modelRef ?? '',
      subagentModelRef: input.subagentModelRef ?? '',
      workspaceId,
      workspaceName: workspaceNameFromCwd(cwd),
      cwd,
      parentConversationId,
      parentRelation: parentConversationId ? (input.parentRelation ?? 'subagent') : null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }
    conversations.insert(summary)
    return summary
  }

  function deleteConversation(chatId: string): void {
    requireConversation(chatId, 'CHAT_CONVERSATION_NOT_FOUND')
    db.transaction(() => {
      messages.deleteAll(chatId)
      conversations.delete(chatId)
    })
  }

  function deleteWorkspace(workspaceId: string): void {
    const hasWorkspace = conversations
      .listWorkspaces()
      .some((workspace) => workspace.id === workspaceId)
    if (!hasWorkspace) {
      throw new TanzoNotFoundError(
        'CHAT_WORKSPACE_NOT_FOUND',
        `Workspace "${workspaceId}" was not found.`
      )
    }
    conversations.deleteWorkspace(workspaceId)
  }

  function setConversationModel(chatId: string, modelRef: string): ConversationSummary {
    const existing = requireConversation(chatId, 'AGENT_DEFINITION_NOT_FOUND')
    const updatedAt = Date.now()
    conversations.setModelRef(chatId, modelRef, updatedAt)
    return { ...existing, modelRef, updatedAt }
  }

  function setConversationTitle(chatId: string, title: string): ConversationSummary {
    const existing = requireConversation(chatId, 'CHAT_CONVERSATION_NOT_FOUND')
    conversations.setTitle(chatId, title)
    return { ...existing, title }
  }

  function setConversationSubagentModel(chatId: string, modelRef: string): ConversationSummary {
    const existing = requireConversation(chatId, 'AGENT_DEFINITION_NOT_FOUND')
    const updatedAt = Date.now()
    conversations.setSubagentModelRef(chatId, modelRef, updatedAt)
    return { ...existing, subagentModelRef: modelRef, updatedAt }
  }

  function setConversationAgent(chatId: string, agentId: string): ConversationSummary {
    const existing = requireConversation(chatId, 'AGENT_DEFINITION_NOT_FOUND')
    const normalizedAgentId = normalizeAgentId(agentId)
    const updatedAt = Date.now()
    conversations.setAgentId(chatId, normalizedAgentId, updatedAt)
    return { ...existing, agentId: normalizedAgentId, updatedAt }
  }

  function safeNormalizeImportedCwd(cwd: string | undefined): string {
    if (!cwd) return normalizeCwd(defaultCwd)
    try {
      return normalizeCwd(cwd)
    } catch {
      return normalizeCwd(defaultCwd)
    }
  }

  function getImportedConversation(
    source: string,
    externalId: string
  ): ImportedConversationRecord | undefined {
    const row = selectImportedConversation.get([source, externalId]) as
      | ImportedConversationRow
      | undefined
    return row ? importedRowToRecord(row) : undefined
  }

  function listImportedConversations(source: string): ImportedConversationRecord[] {
    return (selectImportedConversations.all([source]) as ImportedConversationRow[]).map(
      importedRowToRecord
    )
  }

  function importConversation(input: ImportedConversationInput): ConversationSummary {
    const existing = getImportedConversation(input.source, input.externalId)
    if (existing) {
      const conversation = conversations.get(existing.conversationId)
      if (conversation) return conversation
    }

    const cwd = safeNormalizeImportedCwd(input.cwd)
    const now = Date.now()
    const createdAt = input.createdAt ?? now
    const updatedAt = input.updatedAt ?? createdAt
    const summary: ConversationSummary = {
      id: randomUUID(),
      title: input.title ?? '',
      agentId: 'tanzo',
      modelRef: input.modelRef ?? '',
      subagentModelRef: '',
      workspaceId: workspaceIdFromCwd(cwd),
      workspaceName: workspaceNameFromCwd(cwd),
      cwd,
      parentConversationId: null,
      parentRelation: null,
      createdAt,
      updatedAt,
      archivedAt: null
    }

    db.transaction(() => {
      conversations.insert(summary)
      messages.writeActive(summary.id, input.messages)
      const tailCount = Math.max(0, input.contextTailMessages ?? 12)
      const archived = tailCount === 0 ? input.messages : input.messages.slice(0, -tailCount)
      if (archived.length > 0) {
        const summaryId = randomUUID()
        const summaryText = [
          `已导入的 ${archived.length} 条较早 Codex 消息已为模型上下文折叠。`,
          '完整导入记录仍保留在当前会话历史中。'
        ].join('\n')
        messages.finalizeCompaction(
          summary.id,
          archived.map((message) => message.id),
          summaryId,
          [
            {
              id: summaryId,
              role: 'assistant',
              parts: [
                { type: 'text', text: summaryText },
                {
                  type: 'data-compaction',
                  data: {
                    stage: 'complete',
                    summary: summaryText,
                    summaryId,
                    omittedMessages: archived.length
                  }
                }
              ],
              metadata: { createdAt: now }
            } as TanzoUIMessage,
            ...input.messages.slice(-tailCount)
          ]
        )
      }
      insertImportedConversation.run({
        source: input.source,
        external_id: input.externalId,
        conversation_id: summary.id,
        imported_at: now,
        source_path: input.sourcePath ?? null,
        source_hash: input.sourceHash ?? null
      })
    })

    return conversations.get(summary.id) ?? summary
  }

  async function resolveAgentDefinition(chatId: string): Promise<AgentDefinition> {
    const conversation = requireConversation(chatId, 'AGENT_DEFINITION_NOT_FOUND')
    const def = identity.resolveAgentType(conversation.agentId)
    if (!def) {
      throw new TanzoNotFoundError(
        'AGENT_DEFINITION_NOT_FOUND',
        `Agent "${conversation.agentId}" for conversation "${chatId}" was not found.`
      )
    }
    return conversation.modelRef ? { ...def, modelRef: conversation.modelRef } : def
  }

  return {
    transaction: (fn) => db.transaction(fn),
    createConversation,
    async forkConversation(input): Promise<ForkConversationResult> {
      const source = requireConversation(input.sourceChatId, 'CHAT_CONVERSATION_NOT_FOUND')
      const sourceMessages = await messages.loadFullHistory(source.id)
      const targetIndex = sourceMessages.findIndex((message) => message.id === input.messageId)
      if (targetIndex === -1) {
        throw new TanzoNotFoundError(
          'CHAT_FORK_MESSAGE_NOT_FOUND',
          `Message "${input.messageId}" was not found in conversation "${source.id}".`
        )
      }

      assertForkableTarget(sourceMessages[targetIndex])

      const forkMessages = sourceMessages.slice(0, targetIndex + 1)
      const parentConversationId = source.parentConversationId ?? source.id
      let forked!: ConversationSummary
      db.transaction(() => {
        forked = createConversation({
          title: source.title,
          agentId: source.agentId,
          modelRef: source.modelRef,
          subagentModelRef: source.subagentModelRef,
          workspaceId: source.workspaceId,
          cwd: source.cwd,
          parentConversationId,
          parentRelation: 'fork'
        })
        writeActiveMessages(forked.id, forkMessages)
      })

      return { conversation: forked, messages: forkMessages }
    },
    listConversations: conversations.listVisible,
    listWorkspaces: conversations.listWorkspaces,
    listChildren: conversations.listChildren,
    getConversation: conversations.get,
    importConversation,
    getImportedConversation,
    listImportedConversations,
    depthOf: conversations.depthOf,
    rootOf: conversations.rootOf,
    deleteWorkspace,
    deleteConversation,
    setConversationModel,
    setConversationTitle,
    setConversationSubagentModel,
    setConversationAgent,
    save(chatId, nextMessages) {
      requireConversation(chatId, 'CHAT_CONVERSATION_NOT_FOUND')
      db.transaction(() => writeActiveMessages(chatId, nextMessages))
    },
    finalizeCompaction(chatId, archivedIds, summaryId, nextMessages, expectedActiveIds) {
      db.transaction(() => {
        messages.finalizeCompaction(chatId, archivedIds, summaryId, nextMessages, expectedActiveIds)
        touch(chatId)
      })
    },
    load: messages.load,
    loadFullHistory: messages.loadFullHistory,
    loadDisplay: messages.loadDisplay,
    loadUnvalidated: messages.loadUnvalidated,
    loadArchived: messages.loadArchived,
    getLatestPromptDiagnostic(chatId: string): PromptDiagnosticPrevious | undefined {
      return promptDiagnostics.getLatest(chatId)
    },
    recordPromptDiagnostic(record: PromptCacheDiagnosticRecord): void {
      promptDiagnostics.record(record)
    },
    finishPromptDiagnostic(finish: PromptCacheDiagnosticFinish): void {
      promptDiagnostics.finish(finish)
    },
    markRunOutcome(chatId, runId, status, errorJson) {
      promptDiagnostics.markRunOutcome(chatId, runId, status, errorJson)
    },
    sweepInterruptedRuns() {
      return promptDiagnostics.sweepInterruptedRuns()
    },
    pruneActivityHistory(olderThanMs) {
      const cutoff = Date.now() - olderThanMs
      db.transaction(() => {
        promptDiagnostics.pruneRunsBefore(cutoff)
        toolExecutions.pruneBefore(cutoff)
      })
    },
    listAllQueuedMessages: queuedMessages.listAll,
    saveQueuedMessages(chatId, items) {
      requireConversation(chatId, 'CHAT_CONVERSATION_NOT_FOUND')
      queuedMessages.saveFor(chatId, items)
    },
    tasks: subagentTasks,
    recordToolExecution(record): void {
      toolExecutions.record(record)
    },
    getActivitySummary(range) {
      return activity.getSummary(range)
    },
    getActivityTrend(range) {
      return activity.getTrend(range)
    },
    getActivityReliability(range) {
      return activity.getReliability(range)
    },
    listActivityConversations(range, page) {
      return activity.listConversations(range, page)
    },
    listActivityRuns(range, page) {
      return activity.listRuns(range, page)
    },
    getActivityRunDetail(runId) {
      return activity.getRunDetail(runId)
    },
    resolveAgentDefinition
  }
}
