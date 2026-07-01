import type { IpcMain } from 'electron'
import { createLogger } from '../../logger'
import { registerIpcHandlers } from '../../ipc/router'
import { activityHandlers } from './activity'
import { chatHandlers } from './chat'
import { changeSetHandlers } from './change-set'
import { gitHandlers } from './git'
import { goalHandlers } from './goal'
import { hooksHandlers } from './hooks'
import { policyHandlers } from './policy'
import { pluginHandlers } from './plugins'
import { skillHandlers } from './skills'
import type { AgentIpcDeps, IpcRegistration } from './types'

function allHandlers(deps: AgentIpcDeps): IpcRegistration[] {
  return [
    ...chatHandlers(deps),
    ...goalHandlers(deps),
    ...policyHandlers(deps),
    ...hooksHandlers(deps),
    ...skillHandlers(deps),
    ...pluginHandlers(deps),
    ...activityHandlers(deps),
    ...gitHandlers(deps),
    ...changeSetHandlers(deps)
  ]
}

export function registerAgentIpc(ipcMain: IpcMain, deps: AgentIpcDeps): () => void {
  return registerIpcHandlers(ipcMain, allHandlers(deps), { logger: createLogger('agent.ipc') })
}

export type { AgentIpcDeps }
