import type { SqlDatabase } from '../../database/types'
import type { GoalInjection, GoalLimit, GoalOutcome, GoalUserState, ThreadGoal } from '@shared/goal'

interface GoalRow {
  conversation_id: string
  objective: string
  user_state: string
  outcome: string | null
  goal_limit: string | null
  token_budget: number | null
  tokens_used: number
  time_budget_seconds: number | null
  time_used_seconds: number
  idle_streak: number
  blocker_streak: number
  blocker_last_run_id: string | null
  pending_injection: string | null
  created_at: number
  updated_at: number
}

function rowToGoal(row: GoalRow): ThreadGoal {
  return {
    chatId: row.conversation_id,
    objective: row.objective,
    userState: row.user_state as GoalUserState,
    outcome: (row.outcome as GoalOutcome | null) ?? null,
    limit: (row.goal_limit as GoalLimit | null) ?? null,
    tokenBudget: row.token_budget,
    tokensUsed: row.tokens_used,
    timeBudgetSeconds: row.time_budget_seconds,
    timeUsedSeconds: row.time_used_seconds,
    idleStreak: row.idle_streak,
    blockerStreak: row.blocker_streak,
    blockerLastRunId: row.blocker_last_run_id ?? null,
    pendingInjection: (row.pending_injection as GoalInjection | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface GoalStore {
  get(chatId: string): ThreadGoal | null
  upsert(goal: ThreadGoal): ThreadGoal
  patch(chatId: string, changes: Partial<Omit<ThreadGoal, 'chatId'>>): ThreadGoal | null
  clear(chatId: string): void
}

export function createGoalStore(db: SqlDatabase): GoalStore {
  const upsertStmt = db.prepare(`
    INSERT INTO conversation_goals (
      conversation_id, objective, user_state, outcome, goal_limit, token_budget, tokens_used,
      time_budget_seconds, time_used_seconds, idle_streak, blocker_streak, blocker_last_run_id,
      pending_injection, created_at, updated_at
    ) VALUES (
      @conversation_id, @objective, @user_state, @outcome, @goal_limit, @token_budget, @tokens_used,
      @time_budget_seconds, @time_used_seconds, @idle_streak, @blocker_streak, @blocker_last_run_id,
      @pending_injection, @created_at, @updated_at
    )
    ON CONFLICT(conversation_id) DO UPDATE SET
      objective = excluded.objective,
      user_state = excluded.user_state,
      outcome = excluded.outcome,
      goal_limit = excluded.goal_limit,
      token_budget = excluded.token_budget,
      tokens_used = excluded.tokens_used,
      time_budget_seconds = excluded.time_budget_seconds,
      time_used_seconds = excluded.time_used_seconds,
      idle_streak = excluded.idle_streak,
      blocker_streak = excluded.blocker_streak,
      blocker_last_run_id = excluded.blocker_last_run_id,
      pending_injection = excluded.pending_injection,
      updated_at = excluded.updated_at
  `)
  const selectStmt = db.prepare('SELECT * FROM conversation_goals WHERE conversation_id = ?')
  const deleteStmt = db.prepare('DELETE FROM conversation_goals WHERE conversation_id = ?')

  function get(chatId: string): ThreadGoal | null {
    const row = selectStmt.get([chatId]) as GoalRow | undefined
    return row ? rowToGoal(row) : null
  }

  function upsert(goal: ThreadGoal): ThreadGoal {
    upsertStmt.run({
      conversation_id: goal.chatId,
      objective: goal.objective,
      user_state: goal.userState,
      outcome: goal.outcome,
      goal_limit: goal.limit,
      token_budget: goal.tokenBudget,
      tokens_used: goal.tokensUsed,
      time_budget_seconds: goal.timeBudgetSeconds,
      time_used_seconds: goal.timeUsedSeconds,
      idle_streak: goal.idleStreak,
      blocker_streak: goal.blockerStreak,
      blocker_last_run_id: goal.blockerLastRunId,
      pending_injection: goal.pendingInjection,
      created_at: goal.createdAt,
      updated_at: goal.updatedAt
    })
    return goal
  }

  return {
    get,
    upsert,
    patch(chatId, changes) {
      const goal = get(chatId)
      if (!goal) return null
      return upsert({ ...goal, ...changes, updatedAt: Date.now() })
    },
    clear(chatId) {
      deleteStmt.run([chatId])
    }
  }
}
