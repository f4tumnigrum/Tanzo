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

  /**
   * Override the model used for context compaction. Compaction is a high-input,
   * low-reasoning task — a smaller, faster model (e.g. haiku) is often sufficient
   * and significantly cheaper. Falls back to `modelRef` when omitted.
   */
  compactionModelRef?: string

  /**
   * Agent-specific guidance injected into the compaction prompt. Use this to
   * tell the compaction model which details matter most for this agent type
   * (e.g. "preserve all file paths and test names" for a verify agent).
   */
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
