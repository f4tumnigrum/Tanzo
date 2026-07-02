import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TanzoValidationError } from '@shared/errors'
import { createWorkspaceFs } from '@main/agent/fs/workspace-fs'

let tempDirs: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tanzo-workspace-fs-'))
  const real = await realpath(dir)
  tempDirs.push(real)
  return real
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe('main/agent/fs/workspace-fs', () => {
  it('reads and writes text while preserving bom, encoding, and eol metadata', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root)
    await writeFile(
      join(root, 'utf16.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\r\nb', 'utf16le')])
    )

    const { content, meta } = await fs.readTextMeta('utf16.txt')
    expect(content).toBe('a\nb')
    expect(meta).toEqual({ eol: 'crlf', encoding: 'utf16le', bom: true })

    await fs.writeTextMeta('nested/out.txt', 'x\ny', meta)
    expect(await readFile(join(root, 'nested/out.txt'))).toEqual(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('x\r\ny', 'utf16le')])
    )
  })

  it('refuses stale text writes when the file changed after reading', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root)
    await writeFile(join(root, 'stale.txt'), 'one')

    const { meta, stamp } = await fs.readTextMeta('stale.txt')
    await writeFile(join(root, 'stale.txt'), 'changed')

    await expect(fs.writeTextMeta('stale.txt', 'ours', meta, undefined, stamp)).rejects.toThrow(
      TanzoValidationError
    )
    expect(await readFile(join(root, 'stale.txt'), 'utf8')).toBe('changed')
  })

  it('reads a bounded text window without requiring the full file body', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root)
    await writeFile(join(root, 'large.txt'), 'one\ntwo\nthree\nfour\nfive\n')

    await expect(
      fs.readTextWindow('large.txt', {
        offset: 2,
        limit: 2,
        maxLineWidth: 20,
        maxOutputChars: 100
      })
    ).resolves.toEqual({
      lines: ['two', 'three'],
      totalLines: 4,
      totalLinesKnown: false,
      hasMore: true,
      truncated: false,
      containsNul: false
    })
  })

  it('blocks path escape attempts unless an external read root is registered', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const fs = createWorkspaceFs(root)
    await writeFile(join(outside, 'allowed.txt'), 'ok')

    expect(() => fs.resolve(join(outside, 'allowed.txt'))).toThrow(TanzoValidationError)

    fs.registerReadRoot(outside)
    expect(await fs.read(join(outside, 'allowed.txt'))).toBe('ok')
    await expect(fs.writeAtomic(join(outside, 'blocked.txt'), 'no')).rejects.toThrow(
      TanzoValidationError
    )
  })

  it('rejects stale writes when content changed but mtime+size appear unchanged', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root)
    // Write two files of the same length so the mtime+size check alone could miss it.
    await writeFile(join(root, 'a.txt'), 'AAAA')
    const { meta, stamp } = await fs.readTextMeta('a.txt')

    // Overwrite with different content of the same byte length.
    await writeFile(join(root, 'a.txt'), 'BBBB')
    // Force the mtime to the original value so only the hash differs.
    const { utimesSync } = await import('node:fs')
    utimesSync(join(root, 'a.txt'), new Date(stamp.mtimeMs), new Date(stamp.mtimeMs))

    await expect(fs.writeTextMeta('a.txt', 'ours', meta, undefined, stamp)).rejects.toMatchObject({
      code: 'FS_STALE_WRITE'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('BBBB')
  })

  it('stamp returned by readTextMeta includes a non-empty contentHash', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root)
    await writeFile(join(root, 'f.txt'), 'hello')
    const { stamp } = await fs.readTextMeta('f.txt')
    expect(stamp.contentHash).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
  })

  it('refuses to write credential and .git paths inside the workspace', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root)

    for (const path of ['.env', '.env.local', '.ssh/authorized_keys', '.aws/credentials']) {
      await expect(fs.writeAtomic(path, 'x')).rejects.toMatchObject({
        code: 'FS_CREDENTIAL_PATH'
      })
      await expect(
        fs.writeTextMeta(path, 'x', { eol: 'lf', encoding: 'utf8', bom: false })
      ).rejects.toMatchObject({ code: 'FS_CREDENTIAL_PATH' })
    }

    for (const path of ['.git/hooks/post-checkout', '.git/config']) {
      await expect(fs.writeAtomic(path, 'x')).rejects.toMatchObject({ code: 'FS_GIT_PATH' })
    }

    // Absolute form of the same paths must be caught too (resolveWrite accepts
    // absolute paths inside the root; the guard re-checks the relative form).
    await expect(fs.writeAtomic(join(root, '.env'), 'x')).rejects.toMatchObject({
      code: 'FS_CREDENTIAL_PATH'
    })
    await expect(
      fs.writeAtomic(join(root, '.git', 'hooks', 'pre-commit'), 'x')
    ).rejects.toMatchObject({ code: 'FS_GIT_PATH' })

    // Ordinary writes are unaffected.
    await fs.writeAtomic('src/ok.txt', 'fine')
    expect(await readFile(join(root, 'src', 'ok.txt'), 'utf8')).toBe('fine')
    // Files merely containing "env"/"git" in the name are not blocked.
    await fs.writeAtomic('environment.ts', 'fine')
    await fs.writeAtomic('gitlog.txt', 'fine')
  })

  it('still refuses credential writes in dangerous mode but allows .git writes', async () => {
    const root = await tempRoot()
    const fs = createWorkspaceFs(root, { dangerous: true })

    await expect(fs.writeAtomic(join(root, '.env'), 'x')).rejects.toMatchObject({
      code: 'FS_CREDENTIAL_PATH'
    })
    // dangerous mode is an explicit full-disk opt-in; .git is writable there.
    await fs.writeAtomic(join(root, '.git', 'info', 'exclude'), 'node_modules')
    expect(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')).toBe('node_modules')
  })

  it('allows absolute paths outside the workspace in dangerous mode', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const fs = createWorkspaceFs(root, { dangerous: true })
    const outsideFile = join(outside, 'free.txt')

    await writeFile(outsideFile, 'ok')

    expect(fs.resolve(outsideFile)).toBe(outsideFile)
    expect(await fs.read(outsideFile)).toBe('ok')
    await fs.writeAtomic(join(outside, 'written.txt'), 'yes')
    expect(await readFile(join(outside, 'written.txt'), 'utf8')).toBe('yes')
    await expect(fs.resolveWorkspace(outside)).resolves.toBe(outside)
  })

  it('still rejects credential paths in dangerous mode', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const fs = createWorkspaceFs(root, { dangerous: true })
    const envPath = join(outside, '.env')

    await writeFile(envPath, 'SECRET=1')

    expect(() => fs.resolve(envPath)).toThrow(TanzoValidationError)
    await expect(fs.read(envPath)).rejects.toThrow(TanzoValidationError)
  })

  it('rejects symlinks that resolve outside the workspace for reads and writes', async ({
    skip
  }) => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const fs = createWorkspaceFs(root)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    try {
      await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    } catch (error) {
      // Creating symlinks on Windows requires Developer Mode or elevation.
      // Skip when the OS denies it rather than failing the suite.
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        skip()
        return
      }
      throw error
    }

    await expect(fs.read('link.txt')).rejects.toThrow(TanzoValidationError)

    await fs.writeTextMeta('link.txt', 'x', { eol: 'lf', encoding: 'utf8', bom: false })
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    expect(await readFile(join(root, 'link.txt'), 'utf8')).toBe('x')
  })
})
