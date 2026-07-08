import type { ThreadGoal } from '@shared/goal'
import type { McpService } from '../../mcp/service'
import type { AgentIdentity } from '../agents/types'
import type { WorkspaceFs } from '../fs/types'
import type { Logger } from '../logging'
import type { SearchBackend } from '../search/types'
import type { ShellRunner } from '../shell/types'
import type { ShellSessionService } from '../shell/session-service'
import type { SkillsStore } from '../skills/types'
import type { AgentService } from '../runtime/types'
import type { AgentStore } from '../store-types'
import type { QuestionBroker } from '../question/broker'

export interface BrowserOpener {
  requestOpen(url: string): boolean
}

export interface GoalToolAccess {
  get(chatId: string): ThreadGoal | null
  markOutcome(
    chatId: string,
    status: 'complete' | 'blocked',
    opts?: { runId?: string }
  ):
    | { kind: 'applied' }
    | { kind: 'rejected'; attempts: number; required: number }
    | { kind: 'no-goal' }
}

export interface ToolDeps {
  fs: WorkspaceFs
  shell: ShellRunner
  search: SearchBackend
  mcpService: McpService
  skills: SkillsStore
  shellSessions: ShellSessionService
  questions: QuestionBroker
  logger: Logger
  store: AgentStore
  resolveAgentType: AgentIdentity['resolveAgentType']
  listAgents: AgentIdentity['listAgents']
  listAgentTypes: AgentIdentity['listAgentTypes']
  isRunning: (chatId: string) => boolean
  cancelConversation: (chatId: string) => void
  submitUserMessage: (chatId: string, message: string) => Promise<void>
  rootOf: (chatId: string) => string
  spawnTask: AgentService['spawnTask']
  awaitTask: AgentService['awaitTask']
  getTask: AgentService['getTask']
  listTasks: AgentService['listTasks']
  instructTask: AgentService['instructTask']
  redefineTask: AgentService['redefineTask']
  cancelTask: AgentService['cancelTask']
  addTaskNote: AgentService['addTaskNote']
  waitForNoteTask: AgentService['waitForNoteTask']
  goal: GoalToolAccess
  browser: BrowserOpener

  disabledTools: () => readonly string[]

  browserAutomationEnabled: () => boolean
}
