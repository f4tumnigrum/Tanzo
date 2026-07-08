import type { ToolSet } from 'ai'
import type { PermissionMode } from '@shared/policy'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { AgentDefinition } from '../agents/types'
import type { BuildTools } from '../runtime/types'
import type { ToolDeps } from './types'
import { builtinTools } from './builtin'
import { mcpTools, normalizeMcpToolPattern } from './mcp'
import { providerTools } from './provider'
import { skillTool } from './skill'
import { shellBackgroundTools } from './shell-background'
import { subagentNoteTools } from './subagent-control'
import { subagentTools, type SubagentType } from './subagent'
import { goalTools } from './goal'
import { todoTool } from './todo'
import { exitPlanModeTool } from './exit-plan-mode'
import { askQuestionTool } from './ask-question'

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`)
}

export function toolKeyMatchesPattern(key: string, pattern: string): boolean {
  const normalizedPattern = normalizeMcpToolPattern(pattern.trim())
  if (!normalizedPattern) return false
  if (normalizedPattern === key) return true
  if (normalizedPattern.includes('*')) return globToRegExp(normalizedPattern).test(key)
  return key.startsWith('mcp__') && key.startsWith(`${normalizedPattern}__`)
}

const DEFAULT_MAX_SUBAGENT_DEPTH = 3

const READ_ONLY_SUBAGENT_TOOLS = new Set([
  'fileRead',
  'glob',
  'grep',
  'skill',
  'await',
  'tasks',
  'note',
  'shellPoll',
  'shellList',
  'web_search'
])

function isReadOnlySubagentToolPattern(pattern: string): boolean {
  return READ_ONLY_SUBAGENT_TOOLS.has(normalizeMcpToolPattern(pattern.trim()))
}

function isSafeReadOnlySubagent(agent: AgentDefinition): boolean {
  return (
    agent.kind === 'subagent' &&
    agent.allowedTools != null &&
    agent.allowedTools.length > 0 &&
    agent.allowedTools.every(isReadOnlySubagentToolPattern)
  )
}

function subagentTypesForMode(deps: ToolDeps, mode: PermissionMode): SubagentType[] {
  return deps.listAgents('subagent').map((agent) => {
    const readOnly = isSafeReadOnlySubagent(agent)
    const available = mode !== 'plan' || readOnly
    return {
      name: agent.name,
      description: agent.description,
      readOnly,
      available,
      ...(available ? {} : { unavailableReason: 'plan mode allows read-only sub-agents only' })
    }
  })
}

function hasExitPlanModeApproval(messages: readonly TanzoUIMessage[] | undefined): boolean {
  if (!messages) return false
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === 'tool-exitPlanMode' &&
        (part as { state?: string }).state === 'approval-responded'
    )
  )
}

export function createBuildTools(deps: ToolDeps): BuildTools {
  return async (context) => {
    const { def, chatId, depth, mode } = context
    const maxDepth = def.maxSubagentDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH

    const subAgentTypes = subagentTypesForMode(deps, mode)
    const hasAvailableTypes = subAgentTypes.some((a) => a.available)
    const canDelegate = depth < maxDepth && hasAvailableTypes
    const conversation = deps.store.getConversation(chatId)

    const isSubagent = conversation?.parentRelation === 'subagent'
    const isMainAgent = !isSubagent
    const shouldIncludeExitPlanMode =
      isMainAgent && (mode === 'plan' || hasExitPlanModeApproval(context.messages))
    const merged: ToolSet = {
      ...builtinTools(def, deps),
      ...(await mcpTools(def, deps)),
      ...providerTools(def),
      skill: skillTool(deps),
      todo: todoTool(deps, chatId),
      ...(isMainAgent ? { askQuestion: askQuestionTool(deps, chatId) } : {}),
      ...shellBackgroundTools(deps, chatId),
      ...(canDelegate ? subagentTools(deps, chatId, subAgentTypes) : {}),
      ...(isSubagent ? subagentNoteTools(deps, chatId) : {}),
      ...(isMainAgent ? goalTools(deps, chatId, context.runId) : {}),
      ...(shouldIncludeExitPlanMode ? { exitPlanMode: exitPlanModeTool() } : {})
    }

    const disabled = new Set(deps.disabledTools().map((id) => normalizeMcpToolPattern(id)))
    if (disabled.size > 0) {
      for (const key of Object.keys(merged)) {
        if (disabled.has(key)) delete merged[key]
      }
    }
    const allowed = def.allowedTools
    if (allowed === null) return merged
    const filtered: ToolSet = {}
    for (const [key, value] of Object.entries(merged)) {
      if (allowed.some((pattern) => toolKeyMatchesPattern(key, pattern))) filtered[key] = value
    }
    return filtered
  }
}
