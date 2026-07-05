import type {
  ConversationParentRelation,
  ConversationSummary,
  WorkspaceSummary
} from '@shared/chat'
import type { SqlDatabase } from '../../database/types'

interface WorkspaceRow {
  id: string
  name: string
  root_path: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

interface ConversationRow {
  id: string
  title: string
  agent_id: string
  model_ref: string
  subagent_model_ref: string
  reasoning_effort: string
  workspace_id: string | null
  workspace_name: string | null
  cwd: string | null
  parent_conversation_id: string | null
  parent_relation: ConversationParentRelation | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface ConversationRepo {
  insert(summary: ConversationSummary): void
  get(chatId: string): ConversationSummary | undefined
  listVisible(): ConversationSummary[]
  listWorkspaces(): WorkspaceSummary[]
  listChildren(parentChatId: string, relation?: ConversationParentRelation): ConversationSummary[]
  deleteWorkspace(workspaceId: string): void
  delete(chatId: string): void
  /** Detach fork children so deleting a parent never cascades into them. */
  detachForks(parentChatId: string): void
  touch(chatId: string, updatedAt: number): void
  setTitle(chatId: string, title: string): void
  setModelRef(chatId: string, modelRef: string, updatedAt: number): void
  setSubagentModelRef(chatId: string, modelRef: string, updatedAt: number): void
  setReasoningEffort(chatId: string, effort: string, updatedAt: number): void
  setAgentId(chatId: string, agentId: string, updatedAt: number): void
  depthOf(chatId: string): number
  rootOf(chatId: string): string
}

const WALK_LIMIT = 64

export function createConversationRepo(db: SqlDatabase, fallbackCwd: string): ConversationRepo {
  const upsertWorkspace = db.prepare(`
    INSERT INTO workspaces (id, name, root_path, created_at, updated_at, archived_at)
    VALUES (@id, @name, @root_path, @created_at, @updated_at, NULL)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      root_path = excluded.root_path,
      updated_at = excluded.updated_at
  `)
  const insertConversation = db.prepare(`
    INSERT INTO conversations (
      id, title, agent_id, model_ref, subagent_model_ref, reasoning_effort, workspace_id, cwd, parent_conversation_id, parent_relation, created_at, updated_at, archived_at
    ) VALUES (
      @id, @title, @agent_id, @model_ref, @subagent_model_ref, @reasoning_effort, @workspace_id, @cwd, @parent_conversation_id, @parent_relation, @created_at, @updated_at, @archived_at
    )
  `)
  const conversationProjection = `
    SELECT conversations.*, workspaces.name AS workspace_name
    FROM conversations
    LEFT JOIN workspaces ON workspaces.id = conversations.workspace_id
  `
  const selectConversation = db.prepare(`${conversationProjection} WHERE conversations.id = ?`)
  const selectVisibleConversations = db.prepare(`
    ${conversationProjection}
    WHERE conversations.archived_at IS NULL
      AND (
        conversations.parent_conversation_id IS NULL
        OR (
          conversations.parent_relation = 'fork'
          AND EXISTS (
            SELECT 1
            FROM conversations AS parent_conversations
            WHERE parent_conversations.id = conversations.parent_conversation_id
              AND parent_conversations.archived_at IS NULL
          )
        )
      )
    ORDER BY conversations.updated_at DESC
  `)
  const selectWorkspaces = db.prepare(`
    SELECT id, name, root_path, created_at, updated_at, archived_at
    FROM workspaces
    WHERE archived_at IS NULL
    ORDER BY updated_at DESC
  `)
  const selectChildConversations = db.prepare(`
    ${conversationProjection}
    WHERE conversations.parent_conversation_id = ?
    ORDER BY conversations.updated_at DESC
  `)
  const selectChildConversationsByRelation = db.prepare(`
    ${conversationProjection}
    WHERE conversations.parent_conversation_id = ?
      AND conversations.parent_relation = ?
    ORDER BY conversations.updated_at DESC
  `)
  const deleteWorkspaceRow = db.prepare('DELETE FROM workspaces WHERE id = ?')
  const deleteConversationRow = db.prepare('DELETE FROM conversations WHERE id = ?')
  const detachForkRows = db.prepare(`
    UPDATE conversations
    SET parent_conversation_id = NULL, parent_relation = NULL
    WHERE parent_conversation_id = ? AND parent_relation = 'fork'
  `)
  const touchConversation = db.prepare('UPDATE conversations SET updated_at = @t WHERE id = @id')
  const setTitleRow = db.prepare('UPDATE conversations SET title = @title WHERE id = @id')
  const setModelRefRow = db.prepare(
    'UPDATE conversations SET model_ref = @model_ref, updated_at = @t WHERE id = @id'
  )
  const setSubagentModelRefRow = db.prepare(
    'UPDATE conversations SET subagent_model_ref = @subagent_model_ref, updated_at = @t WHERE id = @id'
  )
  const setReasoningEffortRow = db.prepare(
    'UPDATE conversations SET reasoning_effort = @reasoning_effort, updated_at = @t WHERE id = @id'
  )
  const setAgentIdRow = db.prepare(
    'UPDATE conversations SET agent_id = @agent_id, updated_at = @t WHERE id = @id'
  )

  function rowToWorkspace(row: WorkspaceRow): WorkspaceSummary {
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at
    }
  }

  function rowToConversation(row: ConversationRow): ConversationSummary {
    return {
      id: row.id,
      title: row.title,
      agentId: row.agent_id,
      modelRef: row.model_ref,
      subagentModelRef: row.subagent_model_ref,
      reasoningEffort: row.reasoning_effort,
      workspaceId: row.workspace_id || 'workspace',
      workspaceName: row.workspace_name || undefined,
      cwd: row.cwd || fallbackCwd,
      parentConversationId: row.parent_conversation_id,
      parentRelation: row.parent_relation ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at
    }
  }

  function getRow(chatId: string): ConversationRow | undefined {
    return selectConversation.get([chatId]) as ConversationRow | undefined
  }

  return {
    insert(summary) {
      db.transaction(() => {
        upsertWorkspace.run({
          id: summary.workspaceId,
          name: summary.workspaceName || summary.workspaceId,
          root_path: summary.cwd || fallbackCwd,
          created_at: summary.createdAt,
          updated_at: summary.updatedAt
        })
        insertConversation.run({
          id: summary.id,
          title: summary.title,
          agent_id: summary.agentId,
          model_ref: summary.modelRef,
          subagent_model_ref: summary.subagentModelRef,
          reasoning_effort: summary.reasoningEffort,
          workspace_id: summary.workspaceId,
          cwd: summary.cwd,
          parent_conversation_id: summary.parentConversationId,
          parent_relation: summary.parentRelation,
          created_at: summary.createdAt,
          updated_at: summary.updatedAt,
          archived_at: summary.archivedAt
        })
      })
    },
    get(chatId) {
      const row = getRow(chatId)
      return row ? rowToConversation(row) : undefined
    },
    listVisible() {
      return (selectVisibleConversations.all() as ConversationRow[]).map(rowToConversation)
    },
    listWorkspaces() {
      return (selectWorkspaces.all() as WorkspaceRow[]).map(rowToWorkspace)
    },
    listChildren(parentChatId, relation) {
      const rows = relation
        ? (selectChildConversationsByRelation.all([parentChatId, relation]) as ConversationRow[])
        : (selectChildConversations.all([parentChatId]) as ConversationRow[])
      return rows.map(rowToConversation)
    },
    deleteWorkspace(workspaceId) {
      deleteWorkspaceRow.run([workspaceId])
    },
    delete(chatId) {
      deleteConversationRow.run([chatId])
    },
    detachForks(parentChatId) {
      detachForkRows.run([parentChatId])
    },
    touch(chatId, updatedAt) {
      touchConversation.run({ id: chatId, t: updatedAt })
    },
    setTitle(chatId, title) {
      setTitleRow.run({ id: chatId, title })
    },
    setModelRef(chatId, modelRef, updatedAt) {
      setModelRefRow.run({ id: chatId, model_ref: modelRef, t: updatedAt })
    },
    setSubagentModelRef(chatId, modelRef, updatedAt) {
      setSubagentModelRefRow.run({ id: chatId, subagent_model_ref: modelRef, t: updatedAt })
    },
    setReasoningEffort(chatId, effort, updatedAt) {
      setReasoningEffortRow.run({ id: chatId, reasoning_effort: effort, t: updatedAt })
    },
    setAgentId(chatId, agentId, updatedAt) {
      setAgentIdRow.run({ id: chatId, agent_id: agentId, t: updatedAt })
    },
    // depthOf/rootOf express *execution* lineage: how deep an agent runs below
    // the conversation that owns its policy mode, task registry, and delegation
    // budget. A 'fork' edge is pure UI ancestry — the fork behaves as an
    // independent root — so the walk stops there and only follows 'subagent'
    // edges upward.
    depthOf(chatId) {
      let depth = 0
      let current: string | null = chatId
      for (let i = 0; i < WALK_LIMIT && current; i += 1) {
        const row = getRow(current)
        const parent = row?.parent_conversation_id ?? null
        if (!parent || row?.parent_relation === 'fork') break
        depth += 1
        current = parent
      }
      return depth
    },
    rootOf(chatId) {
      let current = chatId
      for (let i = 0; i < WALK_LIMIT; i += 1) {
        const row = getRow(current)
        const parent = row?.parent_conversation_id ?? null
        if (!parent || row?.parent_relation === 'fork') break
        current = parent
      }
      return current
    }
  }
}
