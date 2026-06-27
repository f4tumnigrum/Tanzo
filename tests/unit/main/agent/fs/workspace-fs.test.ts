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
