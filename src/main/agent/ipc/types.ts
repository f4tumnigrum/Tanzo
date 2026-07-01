export type { IpcHandler, IpcRegistration } from '../../ipc/router'
import type { GoalService } from '../goal/service'
import type { GitService } from '../git/service'
import type { ChangeSetService } from '../git/change-set-service'
import type { AgentIdentity } from '../agents/types'
import type { PolicyEngine, PolicyStore } from '../policy/types'
import type { HookService } from '../hooks/service'
import type { AgentService } from '../runtime/types'
import type { ChatRunSessionRegistry } from '../runtime/run-session-registry'
import type { SkillsStore } from '../skills/types'
import type { PluginsManager } from '../plugins/manager'
import type { AgentStore } from '../store-types'

export interface AgentIpcDeps {
  service: AgentService
  store: AgentStore
  identity: AgentIdentity
  policy: PolicyEngine
  policyStore: PolicyStore
  hooks: HookService
  goal: GoalService
  git: GitService
  changeSet: ChangeSetService
  skills: SkillsStore
  plugins: PluginsManager
  streams: Pick<ChatRunSessionRegistry, 'snapshot'>
}
