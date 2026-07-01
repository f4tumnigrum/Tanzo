import { tool, zodSchema } from 'ai'
import type { TanzoTools } from '@shared/agent-message'
import type { FileMeta, FileStamp } from '../../fs/types'
import type { ToolDeps } from '../types'
import { toolResultToModelOutput } from '../model-output'
import { fsToolError, isErrno } from './shared'
import { fileWriteInputSchema } from '../tool-schemas'

function encodedByteLength(content: string, meta: FileMeta): number {
  const lf = content.replace(/\r\n/g, '\n')
  const withEol = meta.eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf
  const bomBytes = meta.bom ? (meta.encoding === 'utf16le' ? 2 : 3) : 0
  return Buffer.byteLength(withEol, meta.encoding) + bomBytes
}

export const fileWriteTool = (deps: ToolDeps) =>
  tool<
    TanzoTools['fileWrite']['input'],
    TanzoTools['fileWrite']['output'],
    Record<string, unknown>
  >({
    description:
      'Create or overwrite a text file with complete content. Relative paths resolve inside the ' +
      'workspace; absolute paths outside the workspace require dangerous mode. Use when generating a ' +
      'new file or replacing nearly all of an existing file; use fileEdit or multiEdit for targeted edits.',
    inputSchema: zodSchema(fileWriteInputSchema),
    metadata: {
      tanzo: { kind: 'edit', component: 'DiffCard', fingerprintFields: ['path'] }
    },
    toModelOutput: toolResultToModelOutput,
    async execute({ path, content }, { abortSignal }): Promise<TanzoTools['fileWrite']['output']> {
      let meta: FileMeta = { eol: 'lf', encoding: 'utf8', bom: false }
      let stamp: FileStamp | undefined
      try {
        const existing = await deps.fs.readTextMeta(path, abortSignal)
        meta = existing.meta
        stamp = existing.stamp
      } catch (error) {
        if (isErrno(error, 'ENOENT')) {
          // Missing files are created with the default UTF-8/LF metadata.
        } else {
          const mapped = fsToolError(error, path, 'write')
          if (mapped) return mapped
          throw error
        }
      }
      try {
        await deps.fs.writeTextMeta(path, content, meta, abortSignal, stamp)
      } catch (error) {
        const mapped = fsToolError(error, path, 'write')
        if (mapped) return mapped
        throw error
      }
      return { applied: true, bytes: encodedByteLength(content, meta) }
    }
  })
