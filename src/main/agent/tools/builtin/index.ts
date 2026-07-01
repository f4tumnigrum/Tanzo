import type { Tool, ToolSet } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { AgentDefinition } from '../../agents/types'
import type { ToolDeps } from '../types'
import { fileReadTool } from './file-read'
import { fileEditTool } from './file-edit'
import { multiEditTool } from './multi-edit'
import { fileWriteTool } from './file-write'
import { globTool } from './glob'
import { grepTool } from './grep'
import { shellTool } from './shell'
import { browserOpenTool } from './browser-tools'

type BuiltinDefs = {
  [K in keyof TanzoTools]?: Tool<TanzoTools[K]['input'], TanzoTools[K]['output']>
}

export function builtinTools(_def: AgentDefinition, deps: ToolDeps): ToolSet {
  return {
    fileRead: fileReadTool(deps),
    fileEdit: fileEditTool(deps),
    multiEdit: multiEditTool(deps),
    fileWrite: fileWriteTool(deps),
    glob: globTool(deps),
    grep: grepTool(deps),
    shell: shellTool(deps),
    browserOpen: browserOpenTool(deps)
  } satisfies BuiltinDefs
}
