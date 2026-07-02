import { createHash, randomBytes } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { TanzoValidationError } from '@shared/errors'
import type { FileMeta, TextWindow, WorkspaceFs, WorkspaceFsOptions } from './types'
import { assertNonGitPath, assertNonSensitivePath } from '../security/path-safety'

const MAX_EDIT_BYTES = 20 * 1024 * 1024

function detectAndDecode(buf: Buffer): { content: string; meta: FileMeta } {
  let encoding: FileMeta['encoding'] = 'utf8'
  let bom = false
  let body = buf
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    throw new TanzoValidationError(
      'FS_UNSUPPORTED_ENCODING',
      'Refusing to edit a UTF-16BE encoded file.'
    )
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = 'utf16le'
    bom = true
    body = buf.subarray(2)
  } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    bom = true
    body = buf.subarray(3)
  }
  const raw = body.toString(encoding)
  const eol: FileMeta['eol'] = raw.includes('\r\n') ? 'crlf' : 'lf'
  const content = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw
  return { content, meta: { eol, encoding, bom } }
}

function encodeWithMeta(content: string, meta: FileMeta): Buffer {
  const lf = content.replace(/\r\n/g, '\n')
  const withEol = meta.eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf
  const body = Buffer.from(withEol, meta.encoding)
  if (!meta.bom) return body
  const bomBytes = meta.encoding === 'utf16le' ? [0xff, 0xfe] : [0xef, 0xbb, 0xbf]
  return Buffer.concat([Buffer.from(bomBytes), body])
}

function createTextDecoder(first: Buffer): { decoder: StringDecoder; body: Buffer } {
  if (first.length >= 2 && first[0] === 0xff && first[1] === 0xfe) {
    return { decoder: new StringDecoder('utf16le'), body: first.subarray(2) }
  }
  if (first.length >= 3 && first[0] === 0xef && first[1] === 0xbb && first[2] === 0xbf) {
    return { decoder: new StringDecoder('utf8'), body: first.subarray(3) }
  }
  return { decoder: new StringDecoder('utf8'), body: first }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code
}

export function createWorkspaceFs(root: string, options: WorkspaceFsOptions = {}): WorkspaceFs {
  const normalizedRoot = resolve(root)
  const dangerous = options.dangerous === true
  const readRoots: string[] = []

  const within = (target: string, base: string): boolean => {
    const rel = relative(base, target)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  const allowedRead = (abs: string): boolean =>
    within(abs, normalizedRoot) || readRoots.some((r) => within(abs, r))

  const toAbs = (p: string): string => (isAbsolute(p) ? resolve(p) : resolve(normalizedRoot, p))

  const resolveRead = (p: string): string => {
    assertNonSensitivePath(p, {
      code: 'FS_CREDENTIAL_PATH',
      message: 'Refusing to read credential path'
    })
    const abs = toAbs(p)
    if (dangerous || allowedRead(abs)) return abs
    throw new TanzoValidationError('FS_PATH_ESCAPE', `Path escapes workspace sandbox: ${p}`)
  }

  const resolveWrite = (p: string): string => {
    const abs = toAbs(p)
    if (dangerous || within(abs, normalizedRoot)) return abs
    throw new TanzoValidationError('FS_PATH_ESCAPE', `Path escapes workspace sandbox: ${p}`)
  }

  // Guard the write surface in depth: the policy layer has similar rules, but
  // the fs layer is the actual authority boundary for fileWrite/fileEdit.
  // Credential paths stay blocked even in dangerous mode (same as reads);
  // .git writes (hooks = code execution on the next git op) are blocked in
  // sandbox mode only, since dangerous mode is an explicit full-disk opt-in.
  const assertWritablePath = (p: string, abs: string): void => {
    for (const candidate of [p, relative(normalizedRoot, abs)]) {
      if (!candidate) continue
      assertNonSensitivePath(candidate, {
        code: 'FS_CREDENTIAL_PATH',
        message: 'Refusing to write credential path'
      })
      if (!dangerous) {
        assertNonGitPath(candidate, {
          code: 'FS_GIT_PATH',
          message: 'Refusing to write inside the .git directory'
        })
      }
    }
  }

  const assertRealWithinRead = async (abs: string, original: string): Promise<void> => {
    try {
      const real = await realpath(abs)
      if (dangerous) {
        assertNonSensitivePath(real, {
          code: 'FS_CREDENTIAL_PATH',
          message: 'Refusing to read credential path'
        })
        return
      }
      const realRoot = await realpath(normalizedRoot)
      const realReadRoots = await Promise.all(
        readRoots.map(async (root) => {
          try {
            return await realpath(root)
          } catch {
            return root
          }
        })
      )
      const allowed = within(real, realRoot) || realReadRoots.some((root) => within(real, root))
      if (!allowed) {
        throw new TanzoValidationError(
          'FS_PATH_ESCAPE',
          `Path resolves outside workspace sandbox: ${original}`
        )
      }
      if (within(real, realRoot)) {
        assertNonSensitivePath(relative(realRoot, real), {
          code: 'FS_CREDENTIAL_PATH',
          message: 'Refusing to read credential path'
        })
      }
      for (const root of realReadRoots) {
        if (!within(real, root)) continue
        assertNonSensitivePath(relative(root, real), {
          code: 'FS_CREDENTIAL_PATH',
          message: 'Refusing to read credential path'
        })
      }
    } catch (error) {
      if (error instanceof TanzoValidationError) throw error
      if (!isErrno(error, 'ENOENT')) throw error
    }
  }

  const assertRealWithinWrite = (real: string, realRoot: string, original: string): void => {
    if (dangerous) return
    if (!within(real, realRoot)) {
      throw new TanzoValidationError(
        'FS_PATH_ESCAPE',
        `Path resolves outside workspace sandbox: ${original}`
      )
    }
  }

  const ensureWriteParent = async (target: string, signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted()
    if (dangerous) {
      await mkdir(dirname(target), { recursive: true })
      return
    }

    await mkdir(normalizedRoot, { recursive: true })
    const realRoot = await realpath(normalizedRoot)
    const parent = dirname(target)
    const relativeParent = relative(normalizedRoot, parent)
    if (!relativeParent) return

    let current = normalizedRoot
    for (const part of relativeParent.split(sep)) {
      if (!part) continue
      current = resolve(current, part)
      signal?.throwIfAborted()
      try {
        await lstat(current)
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) throw error
        await mkdir(current)
      }
      assertRealWithinWrite(await realpath(current), realRoot, target)
    }
  }

  const atomicWrite = async (
    target: string,
    data: string | Buffer,
    signal?: AbortSignal
  ): Promise<void> => {
    await ensureWriteParent(target, signal)

    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(tmp, data, signal ? { signal } : {})
      await rename(tmp, target)
    } catch (error) {
      await unlink(tmp).catch(() => {})
      throw error
    }
  }

  const readTextWindow = async (
    p: string,
    options: { offset: number; limit: number; maxLineWidth: number; maxOutputChars: number },
    signal?: AbortSignal
  ): Promise<TextWindow> => {
    const abs = resolveRead(p)
    await assertRealWithinRead(abs, p)
    signal?.throwIfAborted()

    const lines: string[] = []
    let decoder: StringDecoder | null = null
    let firstBytes = Buffer.alloc(0)
    let pending = ''
    let lineNo = 1
    let outputChars = 0
    let hasMore = false
    let truncated = false
    let containsNul = false
    let stopped = false

    const maxLineWidth = Math.max(1, options.maxLineWidth)
    const maxOutputChars = Math.max(1, options.maxOutputChars)
    const endLine = options.offset + options.limit - 1

    const takeLine = (line: string): void => {
      if (containsNul || stopped) return
      if (line.includes('\u0000')) {
        containsNul = true
        stopped = true
        return
      }
      if (lineNo > endLine) {
        hasMore = true
        stopped = true
        return
      }
      if (lineNo >= options.offset) {
        const clipped = line.slice(0, maxLineWidth)
        if (clipped.length < line.length) truncated = true
        const nextChars = outputChars + clipped.length
        if (nextChars > maxOutputChars) {
          truncated = true
          stopped = true
          return
        }
        outputChars = nextChars
        lines.push(clipped)
      }
      lineNo += 1
    }

    const consume = (text: string): void => {
      pending += text
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline === -1) return
        const raw = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        takeLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        if (stopped) return
      }
    }

    const stream = createReadStream(abs, { highWaterMark: 64 * 1024 })
    const onAbort = (): void => {
      stream.destroy(new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      for await (const chunk of stream) {
        signal?.throwIfAborted()
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (!decoder) {
          firstBytes = Buffer.concat([firstBytes, buf])
          if (firstBytes.length < 3) continue
          const created = createTextDecoder(firstBytes)
          decoder = created.decoder
          consume(decoder.write(created.body))
        } else {
          consume(decoder.write(buf))
        }
        if (stopped) {
          stream.destroy()
          break
        }
      }
      if (!decoder && firstBytes.length > 0) {
        const created = createTextDecoder(firstBytes)
        decoder = created.decoder
        consume(decoder.write(created.body))
      }
      if (decoder && !stopped) consume(decoder.end())
      if (!stopped && pending.length > 0) {
        takeLine(pending.endsWith('\r') ? pending.slice(0, -1) : pending)
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    return {
      lines,
      totalLines: stopped ? lineNo : Math.max(0, lineNo - 1),
      totalLinesKnown: !stopped,
      hasMore,
      truncated,
      containsNul
    }
  }

  return {
    root: normalizedRoot,
    resolve: resolveRead,
    async resolveWorkspace(p, signal) {
      const abs = resolveWrite(p)
      signal?.throwIfAborted()
      const realTarget = await realpath(abs)
      if (dangerous) return realTarget
      const realRoot = await realpath(normalizedRoot)
      assertRealWithinWrite(realTarget, realRoot, p)
      return realTarget
    },
    async read(p, signal) {
      const abs = resolveRead(p)
      await assertRealWithinRead(abs, p)
      return readFile(abs, { encoding: 'utf8', signal })
    },
    async readTextMeta(p, signal) {
      const abs = resolveRead(p)
      await assertRealWithinRead(abs, p)
      const info = await stat(abs)
      if (info.size > MAX_EDIT_BYTES) {
        throw new TanzoValidationError(
          'FS_FILE_TOO_LARGE',
          `File is too large to edit (${info.size} bytes, limit ${MAX_EDIT_BYTES}).`
        )
      }
      const buf = await readFile(abs, signal ? { signal } : {})
      const contentHash = createHash('sha256').update(buf).digest('hex')
      return { ...detectAndDecode(buf), stamp: { mtimeMs: info.mtimeMs, size: info.size, contentHash } }
    },
    readTextWindow,
    async readBinary(p, signal) {
      const abs = resolveRead(p)
      await assertRealWithinRead(abs, p)
      return readFile(abs, signal ? { signal } : {})
    },
    async stat(p, signal) {
      const abs = resolveRead(p)
      await assertRealWithinRead(abs, p)
      signal?.throwIfAborted()
      const s = await stat(abs)
      return { size: s.size, isFile: s.isFile() }
    },
    async readDir(p, signal) {
      const abs = resolveRead(p)
      await assertRealWithinRead(abs, p)
      signal?.throwIfAborted()
      return readdir(abs)
    },
    async writeAtomic(p, content, signal) {
      const abs = resolveWrite(p)
      assertWritablePath(p, abs)
      await atomicWrite(abs, content, signal)
    },
    async writeTextMeta(p, content, meta, signal, expected) {
      const abs = resolveWrite(p)
      assertWritablePath(p, abs)
      if (expected) {
        const current = await stat(abs).catch((error: unknown) => {
          if (isErrno(error, 'ENOENT')) return null
          throw error
        })
        const mismatch =
          !current ||
          current.mtimeMs !== expected.mtimeMs ||
          current.size !== expected.size
        if (!mismatch && expected.contentHash) {
          // Re-read and hash-compare only when mtime+size appear unchanged;
          // this is the narrow window that the hash closes: same-length/same-mtime
          // concurrent writes that would otherwise slip past the stamp check.
          const currentBuf = await readFile(abs).catch(() => null)
          if (
            currentBuf !== null &&
            createHash('sha256').update(currentBuf).digest('hex') !== expected.contentHash
          ) {
            throw new TanzoValidationError(
              'FS_STALE_WRITE',
              `File changed on disk since it was read: ${p}. Re-read it with fileRead before editing.`,
              { recoverable: true }
            )
          }
        } else if (mismatch) {
          throw new TanzoValidationError(
            'FS_STALE_WRITE',
            `File changed on disk since it was read: ${p}. Re-read it with fileRead before editing.`,
            { recoverable: true }
          )
        }
      }
      await atomicWrite(abs, encodeWithMeta(content, meta), signal)
    },
    registerReadRoot(absoluteDir) {
      const abs = resolve(absoluteDir)
      if (!readRoots.includes(abs)) readRoots.push(abs)
    }
  }
}
