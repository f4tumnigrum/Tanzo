import { tool, zodSchema } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { ToolDeps } from '../types'
import { toolResultToModelOutput } from '../model-output'
import { applyReplacements, lineNumberAt, locate } from './match'
import { fsToolError, isErrno, toolError } from './shared'
import { fileEditInputSchema } from '../tool-schemas'

export const fileEditTool = (deps: ToolDeps) =>
  tool<TanzoTools['fileEdit']['input'], TanzoTools['fileEdit']['output'], Record<string, unknown>>({
    description:
      'Replace exact text in one file. Relative paths resolve inside the workspace; absolute paths ' +
      'outside the workspace require dangerous mode. Use for small, targeted edits after reading the ' +
      'relevant range. oldText must match exactly and uniquely; include surrounding context to ' +
      'disambiguate, or set replaceAll when every occurrence should change. A successful edit ' +
      'shifts line numbers and invalidates earlier fileRead output for this file; re-read before ' +
      'making another edit to the same file.',
    inputSchema: zodSchema(fileEditInputSchema),
    metadata: {
      tanzo: { kind: 'edit', component: 'DiffCard', fingerprintFields: ['path'] }
    },
    toModelOutput: toolResultToModelOutput,
    async execute(
      { path, oldText, newText, replaceAll = false },
      { abortSignal }
    ): Promise<TanzoTools['fileEdit']['output']> {
      let content: string
      let meta: Awaited<ReturnType<ToolDeps['fs']['readTextMeta']>>['meta']
      let stamp: Awaited<ReturnType<ToolDeps['fs']['readTextMeta']>>['stamp']
      try {
        ;({ content, meta, stamp } = await deps.fs.readTextMeta(path, abortSignal))
      } catch (error) {
        if (isErrno(error, 'ENOENT')) {
          return toolError(`File not found: ${path}. Read it first with fileRead.`)
        }
        const mapped = fsToolError(error, path, 'edit')
        if (mapped) return mapped
        throw error
      }
      if (content.includes('\u0000'))
        return toolError('Binary file; not safe to edit as text. Use shell if you must modify it.')

      const loc = locate(content, oldText)
      if (!loc) {
        return toolError('oldText not found. The file may have changed; re-read it with fileRead.')
      }
      if (loc.starts.length > 1 && !replaceAll) {
        return toolError(
          `oldText matched ${loc.starts.length} times. Add surrounding context to make it unique, ` +
            'or set replaceAll:true.'
        )
      }
      const starts = replaceAll ? loc.starts : [loc.starts[0]!]
      const startLine = lineNumberAt(content, starts[0]!)
      const next = applyReplacements(content, starts, loc.length, newText)
      try {
        await deps.fs.writeTextMeta(path, next, meta, abortSignal, stamp)
      } catch (error) {
        const mapped = fsToolError(error, path, 'edit')
        if (mapped) return mapped
        throw error
      }
      return { applied: true, replacements: starts.length, startLine }
    }
  })
