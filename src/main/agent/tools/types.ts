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

/**
 * Minimal browser access exposed to tools. The agent no longer drives pages
 * itself; it only asks the renderer to open the built-in browser panel, which
 * creates the `<webview>` target that chrome-devtools-mcp then controls.
 */
export interface BrowserOpener {
  /** Show the browser panel and load `url`. False if no window can receive it. */
  requestOpen(url: string): boolean
}

export interface GoalToolAccess {
  get(chatId: string): ThreadGoal | null
  markOutcome(chatId: string, status: 'complete' | 'blocked'): boolean
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
  reportTaskPhase: AgentService['reportTaskPhase']
  submitTaskResult: AgentService['submitTaskResult']
  goal: GoalToolAccess
  browser: BrowserOpener
  /** Built-in tool ids the user disabled in settings; filtered out at build time. */
  disabledTools: () => readonly string[]
}
