export type ThreadGoalStatus =
  'active' | 'paused' | 'blocked' | 'budget_limited' | 'usage_limited' | 'complete'

export type GoalUserState = 'active' | 'paused'

export type GoalOutcome = 'complete' | 'blocked'

export type GoalLimit = 'budget' | 'usage'

export type GoalInjection = 'continuation' | 'budget_limit' | 'objective_updated'

export type GoalDecisionReason =
  | 'continue'
  | 'wrap-up'
  | 'idle-limit'
  | 'budget-exhausted'
  | 'plan-mode'
  | 'queued-message'
  | 'not-active'

export interface GoalDecision {
  continue: boolean
  reason: GoalDecisionReason
}

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

  blockerLastRunId: string | null

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

/**
 * A pure interpretation of `/goal <args>` input. Callers perform the side
 * effects (GoalApi/GoalService calls, UI updates) for the returned op.
 *
 * - `show`: report the current goal (or that none is set)
 * - `clear` / `pause` / `resume`: control the existing goal
 * - `update`: change the objective of an existing goal (objective provided)
 * - `create`: create a new goal (objective provided)
 *
 * Note: `update` vs `create` cannot be decided from args alone (it depends on
 * whether a goal already exists). `parseGoalCommand` returns `set` for the
 * objective case; use `resolveGoalMutation` with the current goal to pick.
 */
export type GoalCommandIntent =
  | { op: 'show' }
  | { op: 'clear' }
  | { op: 'pause' }
  | { op: 'resume' }
  | { op: 'set'; objective: string }

/** Pure parse of `/goal` args into an intent. No side effects. */
export function parseGoalCommand(args: string): GoalCommandIntent {
  const trimmed = args.trim()
  if (!trimmed) return { op: 'show' }
  switch (trimmed.toLowerCase()) {
    case 'clear':
      return { op: 'clear' }
    case 'pause':
      return { op: 'pause' }
    case 'resume':
      return { op: 'resume' }
    default:
      return { op: 'set', objective: trimmed }
  }
}

/**
 * i18n keys reported for each goal command outcome, shared by every surface.
 * `set` resolves to `objectiveUpdated` when a goal already exists, else `set`.
 */
export const GOAL_COMMAND_KEYS = {
  current: 'chat.goal.command.current',
  none: 'chat.goal.command.none',
  cleared: 'chat.goal.command.cleared',
  paused: 'chat.goal.command.paused',
  resumed: 'chat.goal.command.resumed',
  objectiveUpdated: 'chat.goal.command.objectiveUpdated',
  set: 'chat.goal.command.set'
} as const

export type GoalCommandKey = (typeof GOAL_COMMAND_KEYS)[keyof typeof GOAL_COMMAND_KEYS]

/** The outcome of a `/goal` command, formatted per surface from `key`. */
export interface GoalCommandResult {
  key: GoalCommandKey
  objective?: string
  status?: string
}

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
