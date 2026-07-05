import { createHash } from 'node:crypto'
import type { ToolSet } from 'ai'
import type { AgentDefinition } from '../agents/types'
import type { ToolDeps } from './types'

type McpKind = 'read' | 'edit'
const TOOL_NAME_MAX_LENGTH = 64

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function sanitizeToolNamePart(value: string, options?: { allowWildcard?: boolean }): string {
  const pattern = options?.allowWildcard ? /[^A-Za-z0-9_*-]+/g : /[^A-Za-z0-9_-]+/g
  const sanitized = value
    .replace(pattern, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return sanitized || 'tool'
}

function fitToolName(name: string, suffix = ''): string {
  if (name.length + suffix.length <= TOOL_NAME_MAX_LENGTH) return `${name}${suffix}`
  return `${name.slice(0, TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

function stableToolName(name: string, rawName: string): string {
  if (name.length <= TOOL_NAME_MAX_LENGTH) return name
  return fitToolName(name, `__${shortHash(rawName)}`)
}

function uniqueToolName(name: string, rawName: string, used: Set<string>): string {
  let candidate = stableToolName(name, rawName)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  let counter = 0
  do {
    const suffix = `__${shortHash(`${rawName}:${counter}`)}`
    candidate = fitToolName(name, suffix)
    counter += 1
  } while (used.has(candidate))
  used.add(candidate)
  return candidate
}

export function mcpToolKey(serverName: string, toolName: string, used?: Set<string>): string {
  const key = `mcp__${sanitizeToolNamePart(serverName)}__${sanitizeToolNamePart(toolName)}`
  const rawKey = `mcp__${serverName}__${toolName}`
  return used ? uniqueToolName(key, rawKey, used) : stableToolName(key, rawKey)
}

export function normalizeMcpToolPattern(pattern: string): string {
  if (!pattern.startsWith('mcp__')) return pattern
  const parts = pattern.split('__')
  if (parts.length === 2) return `mcp__${sanitizeToolNamePart(parts[1] ?? '')}`
  if (parts.length < 3) return pattern
  const [, serverName, ...toolParts] = parts
  return `mcp__${sanitizeToolNamePart(serverName)}__${sanitizeToolNamePart(toolParts.join('__'), {
    allowWildcard: true
  })}`
}

function mapAnnotations(
  annotations: Record<string, unknown> | undefined
): { kind: McpKind; workSignal?: boolean } {
  // No annotations: stay conservative for approval (kind='edit') but do NOT
  // count the call as work evidence — an unannotated read-only search tool
  // must not reset the goal idle streak (Goal v2, invariant I5).
  if (!annotations) return { kind: 'edit', workSignal: false }
  if (annotations.readOnlyHint === true && annotations.destructiveHint !== true) {
    return { kind: 'read' }
  }
  return { kind: 'edit' }
}

export async function mcpTools(def: AgentDefinition, deps: ToolDeps): Promise<ToolSet> {
  const out: ToolSet = {}
  const connected = deps.mcpService.listConnectionStates().filter((s) => s.status === 'connected')
  const allow = def.mcpServers
  const servers = allow ? connected.filter((s) => allow.includes(s.name)) : connected
  const usedToolNames = new Set<string>()
  for (const { name } of servers) {
    try {
      const [tools, defs] = await Promise.all([
        deps.mcpService.toolsForServer(name),
        deps.mcpService.listTools(name)
      ])
      const annOf = new Map(defs.tools.map((d) => [d.name, d.annotations]))
      for (const [toolName, t] of Object.entries(tools)) {
        const hints = mapAnnotations(annOf.get(toolName))
        out[mcpToolKey(name, toolName, usedToolNames)] = {
          ...t,
          metadata: {
            ...t.metadata,
            tanzo: { ...hints, source: { mcp: name, tool: toolName } }
          }
        }
      }
    } catch (error) {
      deps.logger?.warn('failed to build MCP tools for server', { serverName: name, error })
    }
  }
  return out
}
