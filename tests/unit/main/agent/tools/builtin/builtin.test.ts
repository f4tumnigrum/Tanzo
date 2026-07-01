import { describe, expect, it, vi } from 'vitest'
import { TanzoOperationError, TanzoValidationError } from '@shared/errors'
import type { WorkspaceFs } from '@main/agent/fs/types'
import type { ToolDeps } from '@main/agent/tools/types'
import { fileEditTool } from '@main/agent/tools/builtin/file-edit'
import { fileReadTool } from '@main/agent/tools/builtin/file-read'
import { fileWriteTool } from '@main/agent/tools/builtin/file-write'
import { globTool } from '@main/agent/tools/builtin/glob'
import { grepTool } from '@main/agent/tools/builtin/grep'
import { multiEditTool } from '@main/agent/tools/builtin/multi-edit'
import { shellTool } from '@main/agent/tools/builtin/shell'

const meta = { eol: 'lf', encoding: 'utf8', bom: false } as const
const stamp = { mtimeMs: 100, size: 13 } as const

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    fs: {
      root: '/workspace',
      resolve: (path) => `/workspace/${path}`,
      resolveWorkspace: vi.fn(async (path: string) => `/workspace/${path}`),
      read: vi.fn(),
      readTextMeta: vi.fn(),
      readTextWindow: vi.fn(),
      readBinary: vi.fn(),
      stat: vi.fn(),
      readDir: vi.fn(),
      writeAtomic: vi.fn(),
      writeTextMeta: vi.fn(),
      registerReadRoot: vi.fn()
    } as unknown as WorkspaceFs,
    shell: { spawn: vi.fn() },
    search: { glob: vi.fn(), grep: vi.fn() },
    mcpService: {} as never,
    skills: { list: vi.fn(), get: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    store: {} as never,
    resolveAgentType: vi.fn(),
    listAgents: vi.fn(),
    listAgentTypes: vi.fn(),
    isRunning: vi.fn(),
    cancelConversation: vi.fn(),
    submitUserMessage: vi.fn(),
    runNested: vi.fn(),
    spawnBackground: vi.fn(),
    ...overrides
  }
}

async function execute<T>(toolValue: unknown, input: unknown): Promise<T> {
  return (
    toolValue as { execute: (input: unknown, options: { abortSignal?: AbortSignal }) => T }
  ).execute(input, {}) as T
}

describe('main/agent/tools/builtin file tools', () => {
  it('reads paged text with line numbers', async () => {
    const d = deps()
    vi.mocked(d.fs.stat).mockResolvedValue({ size: 12, isFile: true })
    vi.mocked(d.fs.readTextWindow).mockResolvedValue({
      lines: ['b'],
      totalLines: 3,
      totalLinesKnown: true,
      hasMore: true,
      truncated: false,
      containsNul: false
    })

    await expect(
      execute(fileReadTool(d), { path: 'a.txt', startLine: 2, lineCount: 1 })
    ).resolves.toEqual({
      content: '2\tb',
      totalLines: 3,
      totalLinesKnown: true,
      hasMore: true,
      truncated: true
    })
    expect(d.fs.readTextMeta).not.toHaveBeenCalled()
    expect(d.fs.readTextWindow).toHaveBeenCalledWith(
      'a.txt',
      { offset: 2, limit: 1, maxLineWidth: 2000, maxOutputChars: 60000 },
      undefined
    )
  })

  it('keeps path-only reads to a small default window', async () => {
    const d = deps()
    vi.mocked(d.fs.stat).mockResolvedValue({ size: 1200, isFile: true })
    vi.mocked(d.fs.readTextWindow).mockResolvedValue({
      lines: ['first'],
      totalLines: 201,
      totalLinesKnown: false,
      hasMore: true,
      truncated: false,
      containsNul: false
    })

    await expect(execute(fileReadTool(d), { path: 'a.txt' })).resolves.toMatchObject({
      content: '1\tfirst',
      hasMore: true,
      truncated: true
    })
    expect(d.fs.readTextWindow).toHaveBeenCalledWith(
      'a.txt',
      { offset: 1, limit: 500, maxLineWidth: 2000, maxOutputChars: 60000 },
      undefined
    )
  })

  it('reads supported images as base64 file data', async () => {
    const d = deps()
    vi.mocked(d.fs.stat).mockResolvedValue({ size: 3, isFile: true })
    vi.mocked(d.fs.readBinary).mockResolvedValue(Buffer.from('abc'))

    await expect(execute(fileReadTool(d), { path: 'image.png' })).resolves.toEqual({
      kind: 'image',
      data: 'YWJj',
      mediaType: 'image/png',
      bytes: 3
    })
  })

  it('returns a suggested path for missing reads', async () => {
    const d = deps()
    vi.mocked(d.fs.stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    vi.mocked(d.fs.readDir).mockResolvedValue(['Actual.ts'])

    await expect(execute(fileReadTool(d), { path: 'src/actual.ts' })).resolves.toEqual({
      error: true,
      message: 'File not found: src/actual.ts. Did you mean src/Actual.ts?'
    })
  })

  it('edits a unique match and reports the starting line', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockResolvedValue({ content: 'one\ntwo\nthree', meta, stamp })

    await expect(
      execute(fileEditTool(d), { path: 'a.txt', oldText: 'two', newText: '2' })
    ).resolves.toEqual({ applied: true, replacements: 1, startLine: 2 })
    expect(d.fs.writeTextMeta).toHaveBeenCalledWith(
      'a.txt',
      'one\n2\nthree',
      meta,
      undefined,
      stamp
    )
  })

  it('edits a unique match even when oldText uses CRLF line endings', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockResolvedValue({ content: 'one\ntwo\nthree', meta, stamp })

    await expect(
      execute(fileEditTool(d), { path: 'a.txt', oldText: 'one\r\ntwo', newText: '1\n2' })
    ).resolves.toEqual({ applied: true, replacements: 1, startLine: 1 })
    expect(d.fs.writeTextMeta).toHaveBeenCalledWith('a.txt', '1\n2\nthree', meta, undefined, stamp)
  })

  it('does not write when a single edit is ambiguous', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockResolvedValue({ content: 'x x', meta, stamp })

    await expect(
      execute(fileEditTool(d), { path: 'a.txt', oldText: 'x', newText: 'y' })
    ).resolves.toMatchObject({ error: true })
    expect(d.fs.writeTextMeta).not.toHaveBeenCalled()
  })

  it('applies multi-edit replacements sequentially and atomically', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockResolvedValue({ content: 'alpha beta gamma', meta, stamp })

    await expect(
      execute(multiEditTool(d), {
        path: 'a.txt',
        edits: [
          { oldText: 'alpha', newText: 'A' },
          { oldText: 'A beta', newText: 'AB' }
        ]
      })
    ).resolves.toMatchObject({ applied: true, edits: 2, replacements: 2 })
    expect(d.fs.writeTextMeta).toHaveBeenCalledWith('a.txt', 'AB gamma', meta, undefined, stamp)
  })

  it('writes new files with default metadata and existing files with existing encoding', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )

    await expect(execute(fileWriteTool(d), { path: 'new.txt', content: 'hello' })).resolves.toEqual(
      {
        applied: true,
        bytes: 5
      }
    )
    expect(d.fs.writeTextMeta).toHaveBeenCalledWith('new.txt', 'hello', meta, undefined, undefined)
  })

  it('wraps expected edit file-system failures as structured tool errors', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'EACCES' })
    )

    await expect(
      execute(fileEditTool(d), { path: 'locked.txt', oldText: 'a', newText: 'b' })
    ).resolves.toEqual({
      error: true,
      message:
        'Permission denied while trying to edit: locked.txt. Check file permissions or choose a writable path.'
    })
  })

  it('returns a structured stale-write error when a file changes before writeback', async () => {
    const d = deps()
    vi.mocked(d.fs.readTextMeta).mockResolvedValue({ content: 'one two', meta, stamp })
    vi.mocked(d.fs.writeTextMeta).mockRejectedValue(
      new TanzoValidationError(
        'FS_STALE_WRITE',
        'File changed on disk since it was read: a.txt. Re-read it with fileRead before editing.',
        { recoverable: true }
      )
    )

    await expect(
      execute(fileEditTool(d), { path: 'a.txt', oldText: 'two', newText: '2' })
    ).resolves.toEqual({
      error: true,
      message:
        'File changed on disk since it was read: a.txt. Re-read it with fileRead before editing.'
    })
  })
})

describe('main/agent/tools/builtin search tools', () => {
  it('passes glob options through to the search backend', async () => {
    const d = deps()
    vi.mocked(d.search.glob).mockResolvedValue({ paths: ['a.ts'], truncated: false })

    await expect(
      execute(globTool(d), {
        pattern: '**/*.ts',
        directory: 'src',
        includeIgnored: true,
        offset: 10,
        limit: 250
      })
    ).resolves.toEqual({ paths: ['a.ts'], truncated: false })
    expect(d.search.glob).toHaveBeenCalledWith(
      '**/*.ts',
      'src',
      { noIgnore: true, offset: 10, limit: 250 },
      undefined
    )
  })

  it('wraps recoverable search failures as structured errors', async () => {
    const d = deps()
    vi.mocked(d.search.glob).mockRejectedValue(new Error('bad glob'))
    vi.mocked(d.search.grep).mockRejectedValue(
      new TanzoOperationError('RG_FAILED', 'rg failed', { recoverable: true })
    )

    await expect(execute(globTool(d), { pattern: '[' })).resolves.toEqual({
      error: true,
      message: 'bad glob'
    })
    await expect(execute(grepTool(d), { pattern: 'x' })).resolves.toEqual({
      error: true,
      message: 'rg failed'
    })
  })

  it('builds grep queries with defaults and explicit filters', async () => {
    const d = deps()
    vi.mocked(d.search.grep).mockResolvedValue({ mode: 'count', count: 2 })

    await expect(
      execute(grepTool(d), {
        pattern: 'todo',
        mode: 'count',
        includeGlob: '*.ts',
        includeIgnored: true,
        caseInsensitive: true,
        contextBefore: 2,
        contextAfter: 2,
        limit: 5
      })
    ).resolves.toEqual({ mode: 'count', count: 2 })
    expect(d.search.grep).toHaveBeenCalledWith(
      {
        pattern: 'todo',
        mode: 'count',
        headLimit: 5,
        glob: '*.ts',
        noIgnore: true,
        caseInsensitive: true,
        contextBefore: 2,
        contextAfter: 2
      },
      undefined
    )
  })

  it('treats null grep type as no type filter', async () => {
    const d = deps()
    vi.mocked(d.search.grep).mockResolvedValue({ mode: 'files', files: [], truncated: false })

    await expect(
      execute(grepTool(d), { pattern: 'todo', mode: 'files', type: null })
    ).resolves.toEqual({
      mode: 'files',
      files: [],
      truncated: false
    })
    expect(d.search.grep).toHaveBeenCalledWith(
      {
        pattern: 'todo',
        mode: 'files',
        headLimit: 50
      },
      undefined
    )
  })
})

describe('main/agent/tools/builtin shell tool', () => {
  it('streams shell runner events into cumulative tool outputs', async () => {
    const d = deps()
    async function* events() {
      yield { type: 'stdout' as const, data: 'out\u001b[32m ok\u001b[39m' }
      yield { type: 'stderr' as const, data: '\u001b[31merr\u001b[39m' }
      yield { type: 'exit' as const, code: 7, reason: 'exit' as const }
    }
    vi.mocked(d.shell.spawn).mockReturnValue(events())

    const outputs: unknown[] = []
    const stream = (
      shellTool(d) as unknown as {
        execute: (input: unknown, options: unknown) => AsyncIterable<unknown>
      }
    ).execute({ command: 'echo hi', workdir: 'subdir', timeoutMs: 1000 }, {})
    for await (const output of stream) outputs.push(output)

    expect(d.shell.spawn).toHaveBeenCalledWith('echo hi', {
      cwd: '/workspace/subdir',
      timeout: 1000,
      signal: undefined
    })
    expect(outputs).toEqual([
      { stdout: 'out ok', stderr: '', code: 0 },
      { stdout: 'out ok', stderr: 'err', code: 0 },
      { stdout: 'out ok', stderr: 'err', code: 7, reason: 'exit' }
    ])
  })
})
