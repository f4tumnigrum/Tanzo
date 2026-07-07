export interface FileMeta {
  eol: 'lf' | 'crlf'
  encoding: 'utf8' | 'utf16le'
  bom: boolean
}

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

  writeTextMeta(
    path: string,
    content: string,
    meta: FileMeta,
    signal?: AbortSignal,
    expected?: FileStamp
  ): Promise<void>
  registerReadRoot(absoluteDir: string): void
}
