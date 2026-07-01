/**
 * Catalog of user-toggleable built-in tools, grouped by category for the
 * settings UI. The agent always has orchestration tools (skill, todo, goal,
 * subagent control, ask/exit-plan); those are intentionally absent here because
 * disabling them would break the agent loop. MCP and provider tools are managed
 * elsewhere (their own settings) and are not listed.
 *
 * Tool ids match the keys returned by `builtinTools()` so the registry can
 * filter directly against `disabledTools`.
 */

export type ToolCategoryId = 'files' | 'search' | 'shell' | 'browser'

export interface ToolCatalogEntry {
  /** Tool id, matches the registry key (e.g. "browserOpen"). */
  id: string
  category: ToolCategoryId
  /** True for read-only tools (auto-approved). Surfaced as a badge in the UI. */
  readOnly: boolean
}

export interface ToolCategoryDef {
  id: ToolCategoryId
  tools: ToolCatalogEntry[]
}

function entry(id: string, category: ToolCategoryId, readOnly: boolean): ToolCatalogEntry {
  return { id, category, readOnly }
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
    tools: [entry('shell', 'shell', false)]
  },
  {
    id: 'browser',
    tools: [entry('browserOpen', 'browser', false)]
  }
]

/** Flat list of every catalog tool id. */
export const TOOL_CATALOG_IDS: readonly string[] = TOOL_CATALOG.flatMap((c) =>
  c.tools.map((t) => t.id)
)

/** All tool ids in a category, used by the UI's per-category bulk toggle. */
export function toolIdsInCategory(category: ToolCategoryId): string[] {
  return TOOL_CATALOG.find((c) => c.id === category)?.tools.map((t) => t.id) ?? []
}
