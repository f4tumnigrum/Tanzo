import { tool, zodSchema } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { ToolDeps } from '../types'
import { toolResultToModelOutput } from '../model-output'
import { applyReplacements, lineNumberAt, locate } from './match'
import { fsToolError, isErrno, toolError } from './shared'
import { multiEditInputSchema } from '../tool-schemas'

export const multiEditTool = (deps: ToolDeps) =>
  tool<
    TanzoTools['multiEdit']['input'],
    TanzoTools['multiEdit']['output'],
    Record<string, unknown>
  >({
    description:
      'Apply ordered exact-text replacements to one file as a single atomic write. Relative paths ' +
      'resolve inside the workspace; absolute paths outside the workspace require dangerous mode. Use ' +
      'when several nearby or dependent edits belong together. Each edit sees previous edits; if ' +
      'any oldText is missing or ambiguous, nothing is written.',
    inputSchema: zodSchema(multiEditInputSchema),
    metadata: {
      tanzo: { kind: 'edit', component: 'DiffCard', fingerprintFields: ['path'] }
    },
    toModelOutput: toolResultToModelOutput,
    async execute({ path, edits }, { abortSignal }): Promise<TanzoTools['multiEdit']['output']> {
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

      let working = content
      let replacements = 0
      const locations: Array<{ startLine: number; startLines?: number[] }> = []
      for (let i = 0; i < edits.length; i++) {
        const { oldText, newText, replaceAll = false } = edits[i]!
        const loc = locate(working, oldText)
        if (!loc) {
          return toolError(`Edit ${i + 1}: oldText not found. Re-read the file with fileRead.`)
        }
        if (loc.starts.length > 1 && !replaceAll) {
          return toolError(
            `Edit ${i + 1}: oldText matched ${loc.starts.length} times. Add surrounding context, ` +
              'or set replaceAll:true.'
          )
        }
        const starts = replaceAll ? loc.starts : [loc.starts[0]!]
        const startLines = starts.map((start) => lineNumberAt(working, start))
        locations.push({
          startLine: startLines[0]!,
          ...(startLines.length > 1 ? { startLines } : {})
        })
        working = applyReplacements(working, starts, loc.length, newText)
        replacements += starts.length
      }

      try {
        await deps.fs.writeTextMeta(path, working, meta, abortSignal, stamp)
      } catch (error) {
        const mapped = fsToolError(error, path, 'edit')
        if (mapped) return mapped
        throw error
      }
      return { applied: true, edits: edits.length, replacements, locations }
    }
  })
