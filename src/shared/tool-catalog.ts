/**
 * Catalog of built-in tools surfaced in the settings UI, grouped by category.
 * Every runtime-registered builtin appears here so the user can see and manage
 * the agent's full tool surface. Entries marked `locked` are loop-critical
 * (sub-agents deliver results via `report`; plan mode exits via `exitPlanMode`)
 * and are shown for transparency but cannot be disabled. Browser automation is
 * a capability with its own master switch (the `browserAutomation` preference
 * gates browserOpen, the chrome-devtools MCP server, and the browser skill
 * together); within it, `browserOpen` and the chrome-devtools tools can also be
 * disabled individually via `disabledTools`. MCP tools are dynamic
 * (`mcp__<server>__<tool>`) and are managed per server in the same settings
 * tab; their ids share the `disabledTools` preference.
 *
 * Tool ids match the keys returned by the tool registry so it can filter
 * directly against `disabledTools`.
 */

export type ToolCategoryId =
  'files' | 'search' | 'shell' | 'agent' | 'subagents' | 'core' | 'browser'

export interface ToolCatalogEntry {
  /** Tool id, matches the registry key (e.g. "fileRead"). */
  id: string
  category: ToolCategoryId
  /** True for read-only tools (auto-approved). Surfaced as a badge in the UI. */
  readOnly: boolean
  /** Loop-critical tools: visible in settings but cannot be disabled. */
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

/**
 * Tools of the browser-automation capability. Rendered inside the dedicated
 * browser section (not the generic category list) because the section also
 * carries the capability master switch and the chrome-devtools MCP tools.
 */
export const BROWSER_TOOLS: readonly ToolCatalogEntry[] = [entry('browserOpen', 'browser', false)]

/** Flat list of every catalog tool id, including locked ones. */
export const TOOL_CATALOG_IDS: readonly string[] = [
  ...TOOL_CATALOG.flatMap((c) => c.tools.map((t) => t.id)),
  ...BROWSER_TOOLS.map((t) => t.id)
]

/** Ids the user may disable: every catalog id that is not locked. */
export const TOGGLEABLE_TOOL_IDS: readonly string[] = [
  ...TOOL_CATALOG.flatMap((c) => c.tools.filter((t) => !t.locked).map((t) => t.id)),
  ...BROWSER_TOOLS.filter((t) => !t.locked).map((t) => t.id)
]

/** All tool ids in a category, used by the UI's per-category bulk toggle. */
export function toolIdsInCategory(category: ToolCategoryId): string[] {
  return TOOL_CATALOG.find((c) => c.id === category)?.tools.map((t) => t.id) ?? []
}

/** Toggleable (non-locked) tool ids in a category. */
export function toggleableToolIdsInCategory(category: ToolCategoryId): string[] {
  return (
    TOOL_CATALOG.find((c) => c.id === category)
      ?.tools.filter((t) => !t.locked)
      .map((t) => t.id) ?? []
  )
}

/** MCP tool ids are dynamic (`mcp__<server>__<tool>`); they share the
 * `disabledTools` preference with catalog ids but bypass the known-id check. */
export function isMcpToolId(id: string): boolean {
  return id.startsWith('mcp__')
}

/** Build the disable id for an MCP tool. Matching in the registry normalizes
 * both sides, so the raw server/tool names are fine here. */
export function mcpToolId(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}
