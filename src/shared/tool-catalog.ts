export type ToolCategoryId =
  'files' | 'search' | 'shell' | 'agent' | 'subagents' | 'core' | 'browser'

export interface ToolCatalogEntry {
  id: string
  category: ToolCategoryId

  readOnly: boolean

  locked?: boolean
}

export interface ToolCategoryDef {
  id: ToolCategoryId
  tools: ToolCatalogEntry[]
}

function entry(
  id: string,
  category: ToolCategoryId,
  readOnly: boolean,
  locked?: boolean
): ToolCatalogEntry {
  return { id, category, readOnly, ...(locked ? { locked } : {}) }
}

export const TOOL_CATALOG: readonly ToolCategoryDef[] = [
  {
    id: 'files',
    tools: [
      entry('fileRead', 'files', true),
      entry('fileEdit', 'files', false),
      entry('multiEdit', 'files', false),
      entry('fileWrite', 'files', false)
    ]
  },
  {
    id: 'search',
    tools: [entry('glob', 'search', true), entry('grep', 'search', true)]
  },
  {
    id: 'shell',
    tools: [
      entry('shell', 'shell', false),
      entry('shellStart', 'shell', false),
      entry('shellPoll', 'shell', true),
      entry('shellWrite', 'shell', false),
      entry('shellStop', 'shell', false),
      entry('shellList', 'shell', true)
    ]
  },
  {
    id: 'agent',
    tools: [
      entry('skill', 'agent', true),
      entry('todo', 'agent', false),
      entry('askQuestion', 'agent', true),
      entry('updateGoal', 'agent', false)
    ]
  },
  {
    id: 'subagents',
    tools: [
      entry('spawn', 'subagents', false),
      entry('await', 'subagents', true),
      entry('tasks', 'subagents', true),
      entry('steer', 'subagents', false),
      entry('cancel', 'subagents', false)
    ]
  },
  {
    id: 'core',
    tools: [entry('report', 'core', true, true), entry('exitPlanMode', 'core', false, true)]
  }
]

export const BROWSER_TOOLS: readonly ToolCatalogEntry[] = [entry('browserOpen', 'browser', false)]

export const TOOL_CATALOG_IDS: readonly string[] = [
  ...TOOL_CATALOG.flatMap((c) => c.tools.map((t) => t.id)),
  ...BROWSER_TOOLS.map((t) => t.id)
]

export const TOGGLEABLE_TOOL_IDS: readonly string[] = [
  ...TOOL_CATALOG.flatMap((c) => c.tools.filter((t) => !t.locked).map((t) => t.id)),
  ...BROWSER_TOOLS.filter((t) => !t.locked).map((t) => t.id)
]

export function toolIdsInCategory(category: ToolCategoryId): string[] {
  return TOOL_CATALOG.find((c) => c.id === category)?.tools.map((t) => t.id) ?? []
}

export function toggleableToolIdsInCategory(category: ToolCategoryId): string[] {
  return (
    TOOL_CATALOG.find((c) => c.id === category)
      ?.tools.filter((t) => !t.locked)
      .map((t) => t.id) ?? []
  )
}

export function isMcpToolId(id: string): boolean {
  return id.startsWith('mcp__')
}

export function mcpToolId(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}
