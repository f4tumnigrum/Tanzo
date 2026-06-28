import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderService } from '../../provider/service'
import type { SkillsStore } from '../skills/types'
import type { PluginCapabilitySummary } from '../plugins/manager'
import type { ContextEngineDeps } from './index'
import type { GoalSectionReader } from './sections/goal'
import type { PlanModeSectionReader } from './sections/plan-mode'

const PROJECT_INSTRUCTION_CANDIDATES = [
  'TANZO.md',
  '.tanzo/TANZO.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md'
]
const APP_GLOBAL_INSTRUCTION_CANDIDATES = ['TANZO.md', 'AGENTS.md', 'CLAUDE.md']
const HOME_GLOBAL_INSTRUCTION_CANDIDATES = [
  '.tanzo/TANZO.md',
  '.tanzo/AGENTS.md',
  '.claude/CLAUDE.md'
]
const GIT_STATUS_MAX_LINES = 40

export interface ContextEngineWiring {
  userDir?: string
  skills: SkillsStore
  pluginCapabilities: () => PluginCapabilitySummary[]
  pluginMention: { peek: (chatId: string) => string[]; take: (chatId: string) => void }
  providerService: ProviderService
  goal: GoalSectionReader
  policyMode: PlanModeSectionReader
}

export function createContextEngineDeps(wiring: ContextEngineWiring): ContextEngineDeps {
  return {
    clock: { now: () => new Date() },
    tanzoInstructions: {
      read: (cwd) => readTanzoInstructions(cwd, wiring.userDir)
    },
    skillsIndex: {
      list: () =>
        wiring.skills.listEnabled().map((skill) => ({
          name: skill.name,
          description: skill.description
        }))
    },
    pluginsIndex: {
      list: () =>
        wiring.pluginCapabilities().map((plugin) => ({
          name: plugin.name,
          ...(plugin.description ? { description: plugin.description } : {})
        }))
    },
    pluginMention: {
      list: () =>
        wiring.pluginCapabilities().map((plugin) => ({
          name: plugin.name,
          ...(plugin.description ? { description: plugin.description } : {}),
          hasSkills: plugin.hasSkills,
          mcpServerNames: plugin.mcpServerNames
        })),
      peek: (chatId) => wiring.pluginMention.peek(chatId),
      take: (chatId) => wiring.pluginMention.take(chatId)
    },
    gitStatus: {
      read: (cwd) => readGitStatus(cwd)
    },
    goal: wiring.goal,
    policyMode: wiring.policyMode,
    resolveModelMetadata: (modelRef) => {
      const metadata = wiring.providerService.getModelMetadata(modelRef)
      if (!metadata) return undefined
      const out: { contextWindow?: number; maxOutput?: number; vision?: boolean } = {}
      if (metadata.contextWindow !== undefined) out.contextWindow = metadata.contextWindow
      if (metadata.maxOutput !== undefined) out.maxOutput = metadata.maxOutput
      if (metadata.vision !== undefined) out.vision = metadata.vision
      return out
    }
  }
}

function readTanzoInstructions(cwd: string, userDir: string | undefined): string | null {
  const sections: string[] = []
  const global = readGlobalInstructions(userDir)?.trim()
  const project = readProjectInstructions(cwd)?.trim()

  if (global) sections.push(['<global-instructions>', global, '</global-instructions>'].join('\n'))
  if (project)
    sections.push(['<project-instructions>', project, '</project-instructions>'].join('\n'))

  return sections.length ? sections.join('\n\n') : null
}

function readGlobalInstructions(userDir: string | undefined): string | null {
  const candidates = [
    ...(userDir
      ? APP_GLOBAL_INSTRUCTION_CANDIDATES.map((candidate) => join(userDir, candidate))
      : []),
    ...HOME_GLOBAL_INSTRUCTION_CANDIDATES.map((candidate) => join(homedir(), candidate))
  ]
  return readFirstInstructionFile(candidates)
}

function readProjectInstructions(cwd: string): string | null {
  return readFirstInstructionFile(
    PROJECT_INSTRUCTION_CANDIDATES.map((candidate) => join(cwd, candidate))
  )
}

function readFirstInstructionFile(paths: string[]): string | null {
  for (const path of paths) {
    try {
      const content = readFileSync(path, 'utf8')
      if (content.trim()) return content
    } catch {
      continue
    }
  }
  return null
}

function readGitStatus(cwd: string): string | null {
  try {
    const git = (args: string[]): string =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()

    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const mainBranch = readMainBranch(cwd)
    const userName = readGitUser(cwd)
    const log = readRecentCommits(cwd)
    const status = git(['status', '--porcelain'])
      .split('\n')
      .filter((line) => line.length > 0)

    const lines = [`branch: ${branch}`]
    if (mainBranch) lines.push(`main branch (usually used for PRs): ${mainBranch}`)
    if (userName) lines.push(`git user: ${userName}`)

    if (status.length === 0) {
      lines.push('status: clean')
    } else {
      const shown = status.slice(0, GIT_STATUS_MAX_LINES)
      const overflow = status.length - shown.length
      const statusLines = overflow > 0 ? [...shown, `… ${overflow} more`] : shown
      lines.push(`status:\n${statusLines.join('\n')}`)
    }

    if (log) lines.push(`recent commits:\n${log}`)

    return lines.join('\n')
  } catch {
    return null
  }
}

function readMainBranch(cwd: string): string | null {
  try {
    const ref = execFileSync('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return ref.replace(/^origin\//, '') || null
  } catch {
    for (const candidate of ['main', 'master']) {
      try {
        execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], {
          cwd,
          stdio: 'ignore'
        })
        return candidate
      } catch {
        continue
      }
    }
    return null
  }
}

function readGitUser(cwd: string): string | null {
  try {
    return (
      execFileSync('git', ['config', 'user.name'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || null
    )
  } catch {
    return null
  }
}

function readRecentCommits(cwd: string): string | null {
  try {
    return (
      execFileSync('git', ['log', '--oneline', '-n', '5'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || null
    )
  } catch {
    return null
  }
}
