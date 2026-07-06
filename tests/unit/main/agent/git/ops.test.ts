import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addRemote } from '@main/agent/git/ops-write'
import {
  createClientPool,
  readBranches,
  readCommit,
  readDiff,
  readHistory,
  readOverview,
  readStatus,
  type GitClientPool
} from '@main/agent/git/ops'

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve(stdout ?? '')
    })
  })
}

describe('agent/git/ops', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tanzo-git-ops-'))
    await execGit(root, ['init', '-b', 'main'])
    await execGit(root, ['config', 'user.name', 'Test User'])
    await execGit(root, ['config', 'user.email', 'test@example.com'])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns a textual diff for untracked files', async () => {
    await writeFile(join(root, 'untracked.txt'), 'hello\n', 'utf8')

    const result = await readDiff(createClientPool(), {
      cwd: root,
      scope: 'unstaged',
      filePath: 'untracked.txt'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.patch).toContain('untracked.txt')
    expect(result.data.patch).toContain('+hello')
    expect(result.data.truncated).toBe(false)
  })

  it('preserves commit file statuses and rename sources', async () => {
    await writeFile(join(root, 'deleted.txt'), 'delete me\n', 'utf8')
    await writeFile(join(root, 'modified.txt'), 'before\n', 'utf8')
    await writeFile(join(root, 'renamed-old.txt'), 'rename me\n', 'utf8')
    await execGit(root, ['add', '-A'])
    await execGit(root, ['commit', '-m', 'initial'])

    await rm(join(root, 'deleted.txt'))
    await writeFile(join(root, 'added.txt'), 'new\n', 'utf8')
    await writeFile(join(root, 'modified.txt'), 'after\n', 'utf8')
    await rename(join(root, 'renamed-old.txt'), join(root, 'renamed-new.txt'))
    await execGit(root, ['add', '-A'])
    await execGit(root, ['commit', '-m', 'change files'])
    const hash = (await execGit(root, ['rev-parse', 'HEAD'])).trim()

    const result = await readCommit(createClientPool(), root, hash)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byPath = new Map(result.data.files.map((file) => [file.path, file]))
    expect(byPath.get('added.txt')?.status).toBe('added')
    expect(byPath.get('deleted.txt')?.status).toBe('deleted')
    expect(byPath.get('modified.txt')?.status).toBe('modified')
    expect(byPath.get('renamed-new.txt')).toMatchObject({
      status: 'renamed',
      oldPath: 'renamed-old.txt'
    })
  })

  it('fetches the new remote when requested', async () => {
    const calls: string[] = []
    const pool = {
      client() {
        return {
          addRemote: async (name: string, url: string) => {
            calls.push(`add:${name}:${url}`)
          },
          fetch: async (remote: string) => {
            calls.push(`fetch:${remote}`)
          },
          getRemotes: async () => [
            { name: 'origin', refs: { fetch: 'https://example.test/repo.git' } }
          ]
        }
      },
      isRepo: async () => true
    } as unknown as GitClientPool

    const result = await addRemote(pool, {
      cwd: root,
      name: 'origin',
      url: 'https://example.test/repo.git',
      fetch: true
    })

    expect(result.ok).toBe(true)
    expect(calls).toEqual(['add:origin:https://example.test/repo.git', 'fetch:origin'])
  })

  it('computes real ahead/behind and upstream for a tracking branch', async () => {
    const pool = createClientPool()
    // Base commit on main, then a feature branch that tracks main as its upstream.
    await writeFile(join(root, 'base.txt'), 'base\n', 'utf8')
    await execGit(root, ['add', '-A'])
    await execGit(root, ['commit', '-m', 'base'])
    await execGit(root, ['checkout', '-b', 'feature'])
    // Point feature's upstream at main, then diverge: feature +2, behind main +1.
    await execGit(root, ['branch', '--set-upstream-to=main', 'feature'])
    await writeFile(join(root, 'f1.txt'), '1\n', 'utf8')
    await execGit(root, ['add', '-A'])
    await execGit(root, ['commit', '-m', 'f1'])
    await writeFile(join(root, 'f2.txt'), '2\n', 'utf8')
    await execGit(root, ['add', '-A'])
    await execGit(root, ['commit', '-m', 'f2'])
    await execGit(root, ['checkout', 'main'])
    await writeFile(join(root, 'm1.txt'), '1\n', 'utf8')
    await execGit(root, ['add', '-A'])
    await execGit(root, ['commit', '-m', 'm1'])

    const result = await readBranches(pool, root)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const feature = result.data.find((branch) => branch.name === 'feature')
    expect(feature).toBeDefined()
    expect(feature?.upstream).toBe('main')
    // feature has 2 commits main lacks (ahead), main has 1 commit feature lacks (behind).
    expect(feature?.ahead).toBe(2)
    expect(feature?.behind).toBe(1)
    const main = result.data.find((branch) => branch.name === 'main')
    expect(main?.current).toBe(true)
  })

  it('treats an empty initialized repository as a valid unborn branch', async () => {
    const pool = createClientPool()

    const [overview, status, history, branches] = await Promise.all([
      readOverview(pool, root),
      readStatus(pool, root),
      readHistory(pool, root),
      readBranches(pool, root)
    ])

    expect(overview.ok).toBe(true)
    expect(status.ok).toBe(true)
    expect(history.ok).toBe(true)
    expect(branches.ok).toBe(true)
    if (!overview.ok || !status.ok || !history.ok || !branches.ok) return
    expect(overview.data.kind).toBe('repository')
    expect(overview.data.branch).toBe('main')
    expect(overview.data.headSha).toBeNull()
    expect(overview.data.hasInitialCommit).toBe(false)
    expect(status.data.head).toMatchObject({
      ref: 'main',
      hasCommits: false
    })
    expect(history.data.entries).toEqual([])
    expect(branches.data).toEqual([
      {
        name: 'main',
        current: true,
        ahead: 0,
        behind: 0
      }
    ])
  })
})
