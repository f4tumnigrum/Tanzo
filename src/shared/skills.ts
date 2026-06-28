export const SKILL_CHANNELS = {
  list: 'skills:list',
  get: 'skills:get',
  setEnabled: 'skills:set-enabled',
  install: 'skills:install',
  uninstall: 'skills:uninstall',
  reload: 'skills:reload'
} as const

export type SkillScope = 'user' | 'workspace' | 'builtin' | 'plugin'
export type SkillInstallScope = 'user' | 'workspace'

export interface SkillSummary {
  name: string
  description: string
  scope: SkillScope
  enabled: boolean
  installed: boolean
  skillDir: string
  allowedTools: string[] | null
  modelRef?: string
  license?: string
  compatibility?: string
}

export interface SkillDetail extends SkillSummary {
  body: string
  metadata?: Record<string, string>
  installedAt?: number
  sourcePath?: string
}

export interface SkillSnapshot {
  skills: SkillSummary[]
  updatedAt: number
}

export interface InstallSkillInput {
  sourcePath: string
  scope: SkillInstallScope
  enableAfterInstall?: boolean
  replace?: boolean
}

export interface SetSkillEnabledInput {
  name: string
  enabled: boolean
}

export interface SkillApi {
  listSkills(): Promise<SkillSnapshot>
  getSkill(name: string): Promise<SkillDetail | null>
  setSkillEnabled(input: SetSkillEnabledInput): Promise<SkillSnapshot>
  installSkill(input: InstallSkillInput): Promise<SkillSnapshot>
  uninstallSkill(name: string): Promise<SkillSnapshot>
  reloadSkills(): Promise<SkillSnapshot>
}
