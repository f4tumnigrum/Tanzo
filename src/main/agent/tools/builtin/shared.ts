import { TanzoError } from '@shared/errors'
import type { ToolError } from '@shared/agent-message'

export const toolError = (message: string): ToolError => ({ error: true, message })

export function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof TanzoError) return error.code
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function fsToolError(
  error: unknown,
  path: string,
  verb: 'read' | 'edit' | 'write'
): ToolError | null {
  if (error instanceof Error && (error.name === 'AbortError' || isErrno(error, 'ABORT_ERR')))
    return null

  const code = errorCode(error)
  if (!code) return null

  if (error instanceof TanzoError) return toolError(error.message)

  const action = verb === 'read' ? 'read' : verb === 'write' ? 'write' : 'edit'
  if (code === 'EACCES' || code === 'EPERM') {
    return toolError(
      `Permission denied while trying to ${action}: ${path}. Check file permissions or choose a writable path.`
    )
  }
  if (code === 'EISDIR') {
    return toolError(
      `Path is a directory, not a text file: ${path}. Use glob to list directory contents.`
    )
  }
  if (code === 'ENOTDIR') {
    return toolError(
      `A path segment is not a directory: ${path}. Check the path with glob or fileRead.`
    )
  }
  if (code === 'ETXTBSY') {
    return toolError(`File is busy or locked: ${path}. Retry after the process using it exits.`)
  }
  if (code === 'EROFS') {
    return toolError(`Cannot ${action} on a read-only filesystem: ${path}. Choose a writable path.`)
  }
  if (code === 'ENOSPC') {
    return toolError(
      `No space left on device while trying to ${action}: ${path}. Free disk space and retry.`
    )
  }
  if (code === 'EMFILE' || code === 'ENFILE') {
    return toolError(
      `Too many open files while trying to ${action}: ${path}. Close other processes and retry.`
    )
  }

  return null
}
