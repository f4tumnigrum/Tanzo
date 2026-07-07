import type { AgentKind } from '@shared/chat'

export interface AgentDefinition {
  id: string
  name: string
  description: string

  kind: AgentKind
  modelRef: string
  systemPrompt: string
  allowedTools: string[] | null
  mcpServers?: string[]
  enableWebSearch?: boolean
  maxSubagentDepth?: number
  maxSteps?: number

  compactionModelRef?: string

  compactionInstructions?: string
}

export interface AgentLoadError {
  file: string
  message: string
}

export interface AgentIdentity {
  resolveAgentType(name: string): AgentDefinition | undefined

  listAgents(kind: AgentKind): AgentDefinition[]
  listAgentTypes(): AgentDefinition[]

  listLoadErrors(): AgentLoadError[]
}
