import type {
  SubagentTask,
  SubagentTaskBlock,
  SubagentTaskNote,
  SubagentTaskPhase,
  SubagentTaskResult,
  SubagentTaskStatus
} from '@shared/subagent-task'
import type { SqlDatabase } from '../../database/types'

interface TaskRow {
  id: string
  root_chat_id: string
  chat_id: string
  parent_chat_id: string
  agent_type: string
  objective: string
  status: SubagentTaskStatus
  depends_on_json: string
  allowed_tools_json: string | null
  block_json: string | null
  phase: string | null
  phases_json: string
  notes_json: string
  result_json: string | null
  seq: number
  created_at: number
  started_at: number | null
  completed_at: number | null
}

export interface SubagentTaskRepo {
  insert(task: SubagentTask, seq: number): void
  update(task: SubagentTask): void
  get(rootChatId: string, taskId: string): SubagentTask | undefined
  getByChat(chatId: string): SubagentTask | undefined
  listByRoot(rootChatId: string): SubagentTask[]
  listUnsettled(): SubagentTask[]
  nextSeq(rootChatId: string): number
  countByAgent(rootChatId: string, agentType: string): number
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowToTask(row: TaskRow): SubagentTask {
  const block = parseJson<SubagentTaskBlock | null>(row.block_json, null)
  const result = parseJson<SubagentTaskResult | null>(row.result_json, null)
  return {
    id: row.id,
    chatId: row.chat_id,
    parentChatId: row.parent_chat_id,
    rootChatId: row.root_chat_id,
    agentType: row.agent_type,
    objective: row.objective,
    status: row.status,
    dependsOn: parseJson<string[]>(row.depends_on_json, []),
    allowedTools: parseJson<string[] | null>(row.allowed_tools_json, null),
    ...(block ? { block } : {}),
    ...(row.phase ? { phase: row.phase } : {}),
    phases: parseJson<SubagentTaskPhase[]>(row.phases_json, []),
    notes: parseJson<SubagentTaskNote[]>(row.notes_json, []),
    ...(result ? { result } : {}),
    createdAt: row.created_at,
    ...(row.started_at != null ? { startedAt: row.started_at } : {}),
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {})
  }
}

export function createSubagentTaskRepo(db: SqlDatabase): SubagentTaskRepo {
  const insertRow = db.prepare(`
    INSERT INTO subagent_tasks (
      id, root_chat_id, chat_id, parent_chat_id, agent_type, objective, status,
      depends_on_json, allowed_tools_json, block_json, phase, phases_json, notes_json,
      result_json, seq, created_at, started_at, completed_at
    ) VALUES (
      @id, @root_chat_id, @chat_id, @parent_chat_id, @agent_type, @objective, @status,
      @depends_on_json, @allowed_tools_json, @block_json, @phase, @phases_json, @notes_json,
      @result_json, @seq, @created_at, @started_at, @completed_at
    )
  `)
  const updateRow = db.prepare(`
    UPDATE subagent_tasks SET
      objective = @objective,
      status = @status,
      depends_on_json = @depends_on_json,
      allowed_tools_json = @allowed_tools_json,
      block_json = @block_json,
      phase = @phase,
      phases_json = @phases_json,
      notes_json = @notes_json,
      result_json = @result_json,
      started_at = @started_at,
      completed_at = @completed_at
    WHERE root_chat_id = @root_chat_id AND id = @id
  `)
  const selectOne = db.prepare('SELECT * FROM subagent_tasks WHERE root_chat_id = ? AND id = ?')
  const selectByChat = db.prepare('SELECT * FROM subagent_tasks WHERE chat_id = ?')
  const selectByRoot = db.prepare(
    'SELECT * FROM subagent_tasks WHERE root_chat_id = ? ORDER BY seq ASC'
  )
  const selectUnsettled = db.prepare(
    "SELECT * FROM subagent_tasks WHERE status IN ('pending', 'running', 'blocked') ORDER BY seq ASC"
  )
  const selectMaxSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM subagent_tasks WHERE root_chat_id = ?'
  )
  const countAgent = db.prepare(
    'SELECT COUNT(*) AS n FROM subagent_tasks WHERE root_chat_id = ? AND agent_type = ?'
  )

  function bindMutable(task: SubagentTask): Record<string, unknown> {
    return {
      objective: task.objective,
      status: task.status,
      depends_on_json: JSON.stringify(task.dependsOn),
      allowed_tools_json: task.allowedTools == null ? null : JSON.stringify(task.allowedTools),
      block_json: task.block ? JSON.stringify(task.block) : null,
      phase: task.phase ?? null,
      phases_json: JSON.stringify(task.phases),
      notes_json: JSON.stringify(task.notes),
      result_json: task.result ? JSON.stringify(task.result) : null,
      started_at: task.startedAt ?? null,
      completed_at: task.completedAt ?? null
    }
  }

  function bindForInsert(task: SubagentTask, seq: number): Record<string, unknown> {
    return {
      ...bindMutable(task),
      id: task.id,
      root_chat_id: task.rootChatId,
      chat_id: task.chatId,
      parent_chat_id: task.parentChatId,
      agent_type: task.agentType,
      seq,
      created_at: task.createdAt
    }
  }

  return {
    insert(task, seq) {
      insertRow.run(bindForInsert(task, seq))
    },
    update(task) {
      updateRow.run({ ...bindMutable(task), id: task.id, root_chat_id: task.rootChatId })
    },
    get(rootChatId, taskId) {
      const row = selectOne.get([rootChatId, taskId]) as TaskRow | undefined
      return row ? rowToTask(row) : undefined
    },
    getByChat(chatId) {
      const row = selectByChat.get([chatId]) as TaskRow | undefined
      return row ? rowToTask(row) : undefined
    },
    listByRoot(rootChatId) {
      return (selectByRoot.all([rootChatId]) as TaskRow[]).map(rowToTask)
    },
    listUnsettled() {
      return (selectUnsettled.all() as TaskRow[]).map(rowToTask)
    },
    nextSeq(rootChatId) {
      const row = selectMaxSeq.get([rootChatId]) as { max_seq: number }
      return row.max_seq + 1
    },
    countByAgent(rootChatId, agentType) {
      const row = countAgent.get([rootChatId, agentType]) as { n: number }
      return row.n
    }
  }
}
