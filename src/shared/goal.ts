export type ThreadGoalStatus =
  'active' | 'paused' | 'blocked' | 'budget_limited' | 'usage_limited' | 'complete'

export type GoalUserState = 'active' | 'paused'

export type GoalOutcome = 'complete' | 'blocked'

export type GoalLimit = 'budget' | 'usage'

export type GoalInjection = 'continuation' | 'budget_limit' | 'objective_updated'

export interface ThreadGoal {
  chatId: string
  objective: string
  userState: GoalUserState
  outcome: GoalOutcome | null
  limit: GoalLimit | null
  tokenBudget: number | null
  tokensUsed: number
  timeBudgetSeconds: number | null
  timeUsedSeconds: number

  idleStreak: number

  blockerStreak: number

  pendingInjection: GoalInjection | null
  createdAt: number
  updatedAt: number
}

export function deriveStatus(goal: ThreadGoal): ThreadGoalStatus {
  if (goal.outcome) return goal.outcome
  if (goal.limit === 'budget') return 'budget_limited'
  if (goal.limit === 'usage') return 'usage_limited'
  if (goal.userState === 'paused') return 'paused'
  return 'active'
}

export interface CreateGoalInput {
  objective: string
  tokenBudget?: number | null
  timeBudgetSeconds?: number | null
}

export type GoalUserStatusChange = 'paused' | 'active'

export const GOAL_CHANNELS = {
  get: 'goal:get',
  create: 'goal:create',
  updateObjective: 'goal:update-objective',
  setStatus: 'goal:set-status',
  clear: 'goal:clear'
} as const

export type GoalChannel = (typeof GOAL_CHANNELS)[keyof typeof GOAL_CHANNELS]

export interface GoalApi {
  get(chatId: string): Promise<ThreadGoal | null>
  create(chatId: string, input: CreateGoalInput): Promise<ThreadGoal>
  updateObjective(chatId: string, objective: string): Promise<ThreadGoal>
  setStatus(chatId: string, status: GoalUserStatusChange): Promise<ThreadGoal>
  clear(chatId: string): Promise<void>
}
