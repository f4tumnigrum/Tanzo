import { contextBridge } from 'electron'
import log from 'electron-log/preload'
import { activityApi, chatApi, changeSetApi, gitApi, goalApi, policyApi } from './agent'
import { browserApi } from './browser'
import { hooksApi } from './hooks'
import { mcpApi } from './mcp'
import { petApi } from './pet'
import { preferencesApi } from './preferences'
import { providerApi } from './provider'
import { skillsApi } from './skills'
import { pluginsApi } from './plugins'
import { slashCommandApi } from './slash-command'
import { fileMentionApi } from './file-mention'
import { systemApi } from './system'
import { updaterApi } from './updater'

const tanzoApi = {
  ...systemApi,
  preferences: preferencesApi,
  mcp: mcpApi,
  provider: providerApi,
  chat: chatApi,
  policy: policyApi,
  hooks: hooksApi,
  goal: goalApi,
  git: gitApi,
  changeSet: changeSetApi,
  activity: activityApi,
  skills: skillsApi,
  plugins: pluginsApi,
  slashCommand: slashCommandApi,
  fileMention: fileMentionApi,
  pet: petApi,
  browser: browserApi,
  updater: updaterApi,
  process: { versions: process.versions }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', tanzoApi)
  } catch (error) {
    log.scope('preload').error('contextBridge expose failed', error)
  }
} else {
  Object.assign(window, { electron: tanzoApi })
}

export type TanzoElectronAPI = typeof tanzoApi
