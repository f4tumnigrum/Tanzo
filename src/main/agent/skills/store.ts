import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  type Dirent
} from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { TanzoValidationError } from '@shared/errors'
import type {
  InstallSkillInput,
  SkillDetail,
  SkillScope,
  SkillSnapshot,
  SkillSummary
} from '@shared/skills'
import type { SqlDatabase } from '../../database/types'
import type { Logger } from '../logging'
import type { ResolvedSkill, SkillsStore } from './types'
import { BUILTIN_SKILLS } from './builtin-skills'
import { parseFrontmatter } from './frontmatter'
import { createSkillStateStore, type SkillStateStore } from './skill-state-db'

interface SkillRoot {
  dir: string
  scope: SkillScope
}

export interface PluginSkillRootInput {
  dir: string

  namespace: string
}

export interface SkillsStoreDeps {
  workspaceRoot: string
  userDir: string
  logger: Logger
  db?: SqlDatabase

  pluginSkillRoots?: () => PluginSkillRootInput[]

  browserAutomationEnabled?: () => boolean
}

export function createSkillsStore(deps: SkillsStoreDeps): SkillsStore {
  const state: SkillStateStore | null = deps.db ? createSkillStateStore(deps.db) : null
  let skills = loadSkills(deps)

  function userSkillsDir(): string {
    return join(deps.userDir, 'skills')
  }

  function workspaceSkillsDir(): string {
    return join(deps.workspaceRoot, '.claude', 'skills')
  }

  function isEnabled(name: string): boolean {
    return state?.get(name)?.enabled !== false
  }

  function isAvailable(skill: ResolvedSkill): boolean {
    if (skill.scope === 'builtin' && skill.name === 'browser') {
      return deps.browserAutomationEnabled?.() !== false
    }
    return true
  }

  function toSummary(skill: ResolvedSkill): SkillSummary {
    const record = state?.get(skill.name)
    return {
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
      enabled: record?.enabled !== false,
      installed: record?.installed === true,
      skillDir: skill.skillDir,
      allowedTools: skill.allowedTools,
      ...(skill.modelRef ? { modelRef: skill.modelRef } : {}),
      ...(skill.license ? { license: skill.license } : {}),
      ...(skill.compatibility ? { compatibility: skill.compatibility } : {})
    }
  }

  function snapshot(): SkillSnapshot {
    return {
      skills: [...skills.values()].map(toSummary),
      updatedAt: Date.now()
    }
  }

  return {
    list: () => [...skills.values()],
    get: (name) => skills.get(name),
    listEnabled: () =>
      [...skills.values()].filter((skill) => isEnabled(skill.name) && isAvailable(skill)),
    snapshot,
    detail(name) {
      const skill = skills.get(name)
      if (!skill) return null
      const record = state?.get(name)
      return {
        ...toSummary(skill),
        body: skill.body,
        ...(skill.metadata ? { metadata: skill.metadata } : {}),
        ...(record?.installedAt != null ? { installedAt: record.installedAt } : {}),
        ...(record?.sourcePath ? { sourcePath: record.sourcePath } : {})
      } satisfies SkillDetail
    },
    setEnabled(name, enabled) {
      if (!skills.has(name)) {
        throw new TanzoValidationError('SKILL_NOT_FOUND', `Unknown skill "${name}".`)
      }
      state?.setEnabled(name, enabled)
      return snapshot()
    },
    install(input) {
      installSkill(input, { userSkillsDir, workspaceSkillsDir, state, logger: deps.logger })
      skills = loadSkills(deps)
      return snapshot()
    },
    uninstall(name) {
      const record = state?.get(name)
      if (!record?.installed || !record.installPath) {
        throw new TanzoValidationError('SKILL_NOT_INSTALLED', `Skill "${name}" was not installed.`)
      }
      rmSync(record.installPath, { recursive: true, force: true })
      state?.remove(name)
      skills = loadSkills(deps)
      return snapshot()
    },
    reload() {
      skills = loadSkills(deps)
      return snapshot()
    }
  }
}

function installSkill(
  input: InstallSkillInput,
  ctx: {
    userSkillsDir: () => string
    workspaceSkillsDir: () => string
    state: SkillStateStore | null
    logger: Logger
  }
): void {
  const sourcePath = input.sourcePath.trim()
  if (!sourcePath) {
    throw new TanzoValidationError('SKILL_SOURCE_REQUIRED', 'A source directory is required.')
  }
  const manifestPath = join(sourcePath, 'SKILL.md')
  if (!existsSync(manifestPath)) {
    throw new TanzoValidationError(
      'SKILL_MANIFEST_MISSING',
      `No SKILL.md found in "${sourcePath}".`
    )
  }
  const parsed = parseSkillManifest(manifestPath)
  if (!parsed) {
    throw new TanzoValidationError(
      'SKILL_MANIFEST_INVALID',
      `SKILL.md in "${sourcePath}" is missing name or description.`
    )
  }

  const targetRoot = input.scope === 'workspace' ? ctx.workspaceSkillsDir() : ctx.userSkillsDir()
  const targetDir = join(targetRoot, parsed.name)
  const resolvedTarget = resolve(targetDir)
  if (
    resolvedTarget !== resolve(targetRoot, parsed.name) ||
    !resolvedTarget.startsWith(resolve(targetRoot) + sep)
  ) {
    throw new TanzoValidationError(
      'SKILL_NAME_INVALID',
      `Skill name "${parsed.name}" resolves outside the skills directory.`
    )
  }
  if (existsSync(targetDir) && !input.replace) {
    throw new TanzoValidationError(
      'SKILL_ALREADY_EXISTS',
      `A skill directory already exists at "${targetDir}". Enable "Replace existing" to overwrite.`
    )
  }
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  cpSync(sourcePath, targetDir, { recursive: true })

  ctx.state?.recordInstall({
    name: parsed.name,
    enabled: input.enableAfterInstall === true,
    scope: input.scope,
    installPath: targetDir,
    sourcePath,
    installedAt: Date.now()
  })
}

const SKILL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

function isValidSkillName(name: string): boolean {
  return name !== '.' && name !== '..' && SKILL_NAME_RE.test(name)
}

function parseSkillManifest(manifestPath: string): { name: string; description: string } | null {
  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch {
    return null
  }
  const { data } = parseFrontmatter(raw)
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  if (!name || !description || !isValidSkillName(name)) return null
  return { name, description }
}

function loadSkills(deps: SkillsStoreDeps): Map<string, ResolvedSkill> {
  const skills = new Map<string, ResolvedSkill>()
  for (const skill of BUILTIN_SKILLS) skills.set(skill.name, skill)
  const roots: SkillRoot[] = [
    { dir: join(homedir(), '.claude', 'skills'), scope: 'user' },
    { dir: join(homedir(), '.tanzo', 'skills'), scope: 'user' },
    { dir: join(deps.userDir, 'skills'), scope: 'user' },
    { dir: join(deps.workspaceRoot, '.claude', 'skills'), scope: 'workspace' },
    { dir: join(deps.workspaceRoot, '.tanzo', 'skills'), scope: 'workspace' }
  ]
  for (const root of roots) {
    for (const skill of loadFromRoot(root, deps.logger)) {
      skills.set(skill.name, skill)
    }
  }

  for (const pluginRoot of deps.pluginSkillRoots?.() ?? []) {
    for (const skill of loadFromRoot({ dir: pluginRoot.dir, scope: 'plugin' }, deps.logger)) {
      const namespaced = `${pluginRoot.namespace}:${skill.name}`
      skills.set(namespaced, { ...skill, name: namespaced })
    }
  }
  return skills
}

function loadFromRoot(root: SkillRoot, logger: Logger): ResolvedSkill[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(root.dir, { withFileTypes: true })
  } catch {
    return []
  }
  const resolved: ResolvedSkill[] = []
  for (const entry of entries) {
    const entryPath = join(root.dir, entry.name)
    if (!isDirectoryEntry(entry, entryPath)) continue
    const skill = loadSkill(entryPath, root.scope, logger)
    if (skill) resolved.push(skill)
  }
  return resolved
}

function isDirectoryEntry(entry: Dirent, entryPath: string): boolean {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return statSync(entryPath).isDirectory()
  } catch {
    return false
  }
}

function loadSkill(skillDir: string, scope: SkillScope, logger: Logger): ResolvedSkill | undefined {
  const bodyPath = join(skillDir, 'SKILL.md')
  if (!existsSync(bodyPath)) return undefined

  let raw: string
  try {
    raw = readFileSync(bodyPath, 'utf8')
  } catch (error) {
    logger.warn(`failed to read skill ${bodyPath}`, error)
    return undefined
  }

  const { data, body } = parseFrontmatter(raw)
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  if (!name || !description) {
    logger.warn(`skill ${bodyPath} missing name or description; skipped`)
    return undefined
  }
  const dirName = basename(skillDir)
  if (name !== dirName) {
    logger.warn(`skill ${bodyPath} name "${name}" does not match directory "${dirName}"`)
  }

  const modelRef =
    typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
  const license =
    typeof data.license === 'string' && data.license.trim() ? data.license.trim() : undefined
  const compatibility =
    typeof data.compatibility === 'string' && data.compatibility.trim()
      ? data.compatibility.trim()
      : undefined
  const metadata = parseMetadata(data.metadata)

  return {
    name,
    description,
    skillDir,
    body: body.trim(),
    allowedTools: parseAllowedTools(data['allowed-tools']),
    scope,
    ...(modelRef ? { modelRef } : {}),
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(metadata ? { metadata } : {})
  }
}

function parseMetadata(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseAllowedTools(value: unknown): string[] | null {
  const tools = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof value === 'string'
      ? value.split(/[\s,]+/).filter((item) => item.length > 0)
      : []
  return tools.length > 0 ? tools : null
}
