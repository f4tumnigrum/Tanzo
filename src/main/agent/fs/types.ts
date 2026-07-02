export interface FileMeta {
  eol: 'lf' | 'crlf'
  encoding: 'utf8' | 'utf16le'
  bom: boolean
}

/**
 * A snapshot of a file's on-disk identity captured at read time and re-checked
 * before an edit writes back. Used to detect that the file changed underneath
 * an edit tool between read and write (concurrent/external modification).
 *
 * `contentHash` is the hex-encoded SHA-256 of the raw file buffer. It guards
 * against the false-positive window in mtime+size comparison: two writes that
 * land within the mtime resolution AND produce the same byte length (e.g. a
 * same-length reformatting by an external tool) now still trigger FS_STALE_WRITE.
 */
export interface FileStamp {
  mtimeMs: number
  size: number
  contentHash: string
}

export interface TextWindow {
  lines: string[]
  totalLines: number
  totalLinesKnown: boolean
  hasMore: boolean
  truncated: boolean
  containsNul: boolean
}

export interface WorkspaceFsOptions {
  dangerous?: boolean
}

export interface WorkspaceFs {
  root: string
  resolve(path: string): string
  resolveWorkspace(path: string, signal?: AbortSignal): Promise<string>
  read(path: string, signal?: AbortSignal): Promise<string>

  readTextMeta(
    path: string,
    signal?: AbortSignal
  ): Promise<{ content: string; meta: FileMeta; stamp: FileStamp }>
  readTextWindow(
    path: string,
    options: { offset: number; limit: number; maxLineWidth: number; maxOutputChars: number },
    signal?: AbortSignal
  ): Promise<TextWindow>

  readBinary(path: string, signal?: AbortSignal): Promise<Buffer>
  stat(path: string, signal?: AbortSignal): Promise<{ size: number; isFile: boolean }>

  readDir(path: string, signal?: AbortSignal): Promise<string[]>
  writeAtomic(path: string, content: string, signal?: AbortSignal): Promise<void>

  /**
   * Write `content` with the given format metadata. When `expected` is provided,
   * the file's current stamp is re-checked first and the write is refused with
   * an `FS_STALE_WRITE` error if it no longer matches.
   */
  writeTextMeta(
    path: string,
    content: string,
    meta: FileMeta,
    signal?: AbortSignal,
    expected?: FileStamp
  ): Promise<void>
  registerReadRoot(absoluteDir: string): void
}
