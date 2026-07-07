import { createHash, randomUUID } from 'crypto'
import { realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type {
  ChatRunOutcomeError,
  ConversationSummary,
  ForkConversationResult,
  NewConversationInput
} from '@shared/chat'
import type { TanzoUIMessage } from '@shared/agent-message'
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
      if ((part.type === 'text' || part.type === 'reasoning') && state === 'streaming') {
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
      reasoningEffort: input.reasoningEffort ?? '',
      workspaceId,
      workspaceName: workspaceNameFromCwd(cwd),
      cwd,
      parentConversationId,
      parentRelation: parentConversationId ? (input.parentRelation ?? 'subagent') : null,
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }
    conversations.insert(summary)
    return summary
  }

  /**
   * Ensure a conversation with a caller-provided id exists, creating it if absent. Used by
   * external drivers (e.g. the chat bridge) that address conversations by a stable external
   * id (`qq:group:{id}`) rather than a generated UUID. Idempotent.
   */
  function ensureConversation(id: string, input: NewConversationInput = {}): ConversationSummary {
    const existing = conversations.get(id)
    if (existing) return existing
    const now = Date.now()
    const cwd = normalizeCwd(input.cwd ?? defaultCwd)
    const workspaceId = input.workspaceId?.trim() || workspaceIdFromCwd(cwd)
    const parentConversationId = input.parentConversationId ?? null
    const summary: ConversationSummary = {
      id,
      title: input.title ?? '',
      agentId: normalizeAgentId(input.agentId),
      modelRef: input.modelRef ?? '',
      subagentModelRef: input.subagentModelRef ?? '',
      reasoningEffort: input.reasoningEffort ?? '',
      workspaceId,
      workspaceName: workspaceNameFromCwd(cwd),
      cwd,
      parentConversationId,
      parentRelation: parentConversationId ? (input.parentRelation ?? 'subagent') : null,
      pinnedAt: null,
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
      // Forks survive their parent: detach them first so the FK cascade only
      // removes subagent children. Detached forks become root conversations.
      conversations.detachForks(chatId)
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

  function setConversationReasoningEffort(chatId: string, effort: string): ConversationSummary {
    const existing = requireConversation(chatId, 'CHAT_CONVERSATION_NOT_FOUND')
    const updatedAt = Date.now()
    conversations.setReasoningEffort(chatId, effort, updatedAt)
    return { ...existing, reasoningEffort: effort, updatedAt }
  }

  function setConversationAgent(chatId: string, agentId: string): ConversationSummary {
    const existing = requireConversation(chatId, 'AGENT_DEFINITION_NOT_FOUND')
    const normalizedAgentId = normalizeAgentId(agentId)
    const updatedAt = Date.now()
    conversations.setAgentId(chatId, normalizedAgentId, updatedAt)
    return { ...existing, agentId: normalizedAgentId, updatedAt }
  }

  function setConversationPinned(chatId: string, pinned: boolean): ConversationSummary {
    const existing = requireConversation(chatId, 'CHAT_CONVERSATION_NOT_FOUND')
    // Pinning is sidebar-only metadata; leave updated_at untouched so it does
    // not reshuffle activity-based ordering.
    const pinnedAt = pinned ? Date.now() : null
    conversations.setPinnedAt(chatId, pinnedAt)
    return { ...existing, pinnedAt }
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
    ensureConversation,
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
          reasoningEffort: source.reasoningEffort,
          workspaceId: source.workspaceId,
          cwd: source.cwd,
          parentConversationId,
          parentRelation: 'fork'
        })
        writeActiveMessages(forked.id, forkMessages)
        // Carry the source's compaction state across so the fork starts with
        // the same context projection (summary + tail) instead of the full
        // uncompacted history.
        messages.copyOverlaysForFork(source.id, forked.id)
      })

      return { conversation: forked }
    },
    listConversations: conversations.listVisible,
    listWorkspaces: conversations.listWorkspaces,
    listChildren: conversations.listChildren,
    getConversation: conversations.get,
    depthOf: conversations.depthOf,
    rootOf: conversations.rootOf,
    deleteWorkspace,
    deleteConversation,
    setConversationModel,
    setConversationTitle,
    setConversationSubagentModel,
    setConversationReasoningEffort,
    setConversationAgent,
    setConversationPinned,
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
    getLatestRunOutcome(chatId) {
      const row = promptDiagnostics.getLatestRunOutcome(chatId)
      if (!row) return null
      let error: ChatRunOutcomeError | undefined
      if (row.errorJson) {
        try {
          const parsed = JSON.parse(row.errorJson) as Record<string, unknown>
          if (typeof parsed.kind === 'string') {
            error = {
              kind: parsed.kind,
              ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
              ...(typeof parsed.code === 'string' ? { code: parsed.code } : {}),
              ...(parsed.detail && typeof parsed.detail === 'object'
                ? { detail: parsed.detail as ChatRunOutcomeError['detail'] }
                : {})
            }
          }
        } catch {
          // Malformed legacy rows degrade to a missing error, never a crash.
        }
      }
      return {
        runId: row.externalRunId,
        status: row.status,
        finishedAt: row.finishedAt,
        ...(error ? { error } : {})
      }
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
