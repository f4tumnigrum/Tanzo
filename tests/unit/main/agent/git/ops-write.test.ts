import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addRemote,
  checkout,
  commit,
  createBranch,
  deleteBranch,
  discard,
  init,
  pull,
  push,
  removeRemote,
  restoreStaged,
  restoreWorktree,
  setUser,
  stage
} from '@main/agent/git/ops-write'
import { createClientPool, readStatus, type GitClientPool } from '@main/agent/git/ops'

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

async function initRepo(root: string): Promise<void> {
  await execGit(root, ['init', '-b', 'main'])
  await execGit(root, ['config', 'user.name', 'Test User'])
  await execGit(root, ['config', 'user.email', 'test@example.com'])
  await execGit(root, ['config', 'core.autocrlf', 'false'])
  await execGit(root, ['config', 'core.eol', 'lf'])
}

async function commitFile(root: string, name: string, content: string): Promise<void> {
  await writeFile(join(root, name), content, 'utf8')
  await execGit(root, ['add', name])
  await execGit(root, ['commit', '-m', `add ${name}`])
}

describe('agent/git/ops-write', () => {
  let root: string
  let pool: GitClientPool

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tanzo-git-write-'))
    await initRepo(root)
    pool = createClientPool()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  describe('stage / restore', () => {
    it('stages a working-tree file and reports it in the staged scope', async () => {
      await writeFile(join(root, 'a.txt'), 'hello\n', 'utf8')

      const result = await stage(pool, { cwd: root, paths: ['a.txt'] })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const entry = result.data.entries.find((e) => e.path === 'a.txt')
      expect(entry?.staged?.status).toBe('added')
    })

    it('returns current status without staging when paths is empty', async () => {
      await writeFile(join(root, 'a.txt'), 'hello\n', 'utf8')

      const result = await stage(pool, { cwd: root, paths: [] })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Untracked, not staged, because the empty-paths fast path skips `git add`.
      const entry = result.data.entries.find((e) => e.path === 'a.txt')
      expect(entry?.untracked).toBe(true)
      expect(entry?.staged).toBeUndefined()
    })

    it('restoreStaged unstages a previously staged file', async () => {
      await writeFile(join(root, 'a.txt'), 'hello\n', 'utf8')
      await execGit(root, ['add', 'a.txt'])

      const result = await restoreStaged(pool, { cwd: root, paths: ['a.txt'] })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const entry = result.data.entries.find((e) => e.path === 'a.txt')
      expect(entry?.untracked).toBe(true)
      expect(entry?.staged).toBeUndefined()
    })

    it('restoreWorktree reverts unstaged modifications to a tracked file', async () => {
      await commitFile(root, 'a.txt', 'original\n')
      await writeFile(join(root, 'a.txt'), 'modified\n', 'utf8')

      const result = await restoreWorktree(pool, { cwd: root, paths: ['a.txt'] })

      expect(result.ok).toBe(true)
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('original\n')
    })
  })

  describe('discard', () => {
    it('reverts a tracked file and cleans an untracked file when discarded alone', async () => {
      await commitFile(root, 'tracked.txt', 'original\n')
      await writeFile(join(root, 'tracked.txt'), 'changed\n', 'utf8')
      await execGit(root, ['add', 'tracked.txt'])

      const result = await discard(pool, { cwd: root, paths: ['tracked.txt'] })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(await readFile(join(root, 'tracked.txt'), 'utf8')).toBe('original\n')
      expect(result.data.isClean).toBe(true)
    })

    it('removes an untracked file when discarded alone', async () => {
      await commitFile(root, 'seed.txt', 'seed\n')
      await writeFile(join(root, 'new.txt'), 'junk\n', 'utf8')

      const result = await discard(pool, { cwd: root, paths: ['new.txt'] })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toThrow()
      expect(result.data.isClean).toBe(true)
    })

    it('reverts the tracked file AND removes the untracked file when both are discarded together', async () => {
      // discard now partitions paths: tracked ones are reset+checked out from HEAD,
      // untracked ones are cleaned. Mixing the two no longer aborts the tracked revert
      // (the previous behavior where `git checkout -- <untracked>` failed the whole batch).
      await commitFile(root, 'tracked.txt', 'original\n')
      await writeFile(join(root, 'tracked.txt'), 'changed\n', 'utf8')
      await execGit(root, ['add', 'tracked.txt'])
      await writeFile(join(root, 'new.txt'), 'junk\n', 'utf8')

      const result = await discard(pool, { cwd: root, paths: ['tracked.txt', 'new.txt'] })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(await readFile(join(root, 'tracked.txt'), 'utf8')).toBe('original\n')
      await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toThrow()
      expect(result.data.isClean).toBe(true)
    })

    it('is a no-op that returns status when paths is empty', async () => {
      await writeFile(join(root, 'keep.txt'), 'stay\n', 'utf8')

      const result = await discard(pool, { cwd: root, paths: [] })

      expect(result.ok).toBe(true)
      // The untracked file is untouched because the empty-paths guard returns early.
      expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('stay\n')
    })
  })

  describe('commit', () => {
    it('commits staged changes and returns the hash and branch', async () => {
      await writeFile(join(root, 'a.txt'), 'hello\n', 'utf8')
      await execGit(root, ['add', 'a.txt'])

      const result = await commit(pool, { cwd: root, message: 'first commit' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.hash).toMatch(/^[0-9a-f]{7,40}$/)
      expect(result.data.message).toBe('first commit')
      const log = await execGit(root, ['log', '--oneline'])
      expect(log).toContain('first commit')
    })

    it('CHARACTERIZATION: an empty commit succeeds with an empty hash rather than failing', async () => {
      // Known quirk: simple-git's `.commit()` with nothing staged does NOT throw; it
      // resolves with an empty `commit` field. So ops-write.commit returns ok:true with
      // an empty hash instead of a `nothing-to-commit` GitResult failure.
      await commitFile(root, 'seed.txt', 'seed\n')

      const result = await commit(pool, { cwd: root, message: 'empty' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.hash).toBe('')
      // No new commit was actually created.
      const count = (await execGit(root, ['rev-list', '--count', 'HEAD'])).trim()
      expect(count).toBe('1')
    })

    it('amends the previous commit when amend is given an explicit message', async () => {
      await commitFile(root, 'a.txt', 'v1\n')
      await writeFile(join(root, 'a.txt'), 'v2\n', 'utf8')
      await execGit(root, ['add', 'a.txt'])

      const result = await commit(pool, { cwd: root, amend: true, message: 'v2 amended' })

      expect(result.ok).toBe(true)
      // Amend keeps a single commit on the branch.
      const count = (await execGit(root, ['rev-list', '--count', 'HEAD'])).trim()
      expect(count).toBe('1')
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('v2\n')
      expect((await execGit(root, ['log', '--oneline'])).trim()).toContain('v2 amended')
    })

    it('CHARACTERIZATION: amend + noEdit without a message fails on the empty message', async () => {
      // Known quirk: `input.message ?? ''` passes an empty string, and simple-git treats
      // `commit('', ['--amend', '--no-edit'])` as an abort ("empty commit message") rather
      // than reusing the prior message. An amend that means to keep the old message must
      // currently supply it explicitly.
      await commitFile(root, 'a.txt', 'v1\n')
      await writeFile(join(root, 'a.txt'), 'v2\n', 'utf8')
      await execGit(root, ['add', 'a.txt'])

      const result = await commit(pool, { cwd: root, amend: true, noEdit: true })

      expect(result.ok).toBe(false)
    })
  })

  describe('branches', () => {
    it('creates and switches to a new branch', async () => {
      await commitFile(root, 'a.txt', 'hello\n')

      const result = await createBranch(pool, { cwd: root, name: 'feature' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.head.ref).toBe('feature')
    })

    it('checks out an existing ref', async () => {
      await commitFile(root, 'a.txt', 'hello\n')
      await execGit(root, ['branch', 'other'])

      const result = await checkout(pool, { cwd: root, ref: 'other' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.head.ref).toBe('other')
    })

    it('deletes a branch that is not checked out', async () => {
      await commitFile(root, 'a.txt', 'hello\n')
      await execGit(root, ['branch', 'stale'])

      const result = await deleteBranch(pool, { cwd: root, name: 'stale' })

      expect(result.ok).toBe(true)
      const branches = await execGit(root, ['branch', '--list'])
      expect(branches).not.toContain('stale')
    })

    it('rejects a branch name that looks like an option flag', async () => {
      await commitFile(root, 'a.txt', 'hello\n')

      const result = await createBranch(pool, { cwd: root, name: '--upload-pack=evil' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toContain('Invalid branch')
    })

    it('rejects a checkout ref that looks like an option flag', async () => {
      const result = await checkout(pool, { cwd: root, ref: '--orphan' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toContain('Invalid ref')
    })
  })

  describe('remotes', () => {
    it('adds and lists a remote with a safe https url', async () => {
      const result = await addRemote(pool, {
        cwd: root,
        name: 'origin',
        url: 'https://example.com/repo.git'
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.map((r) => r.name)).toContain('origin')
    })

    it('accepts scp-like ssh shorthand urls', async () => {
      const result = await addRemote(pool, {
        cwd: root,
        name: 'origin',
        url: 'git@github.com:owner/repo.git'
      })

      expect(result.ok).toBe(true)
    })

    it('rejects a remote url with an unsupported scheme', async () => {
      const result = await addRemote(pool, {
        cwd: root,
        name: 'origin',
        url: 'ftp://example.com/repo.git'
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toContain('Unsupported remote url scheme')
    })

    it('rejects a remote name that looks like an option flag', async () => {
      const result = await addRemote(pool, {
        cwd: root,
        name: '--config=core.pager=evil',
        url: 'https://example.com/repo.git'
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toContain('Invalid remote')
    })

    it('removes an existing remote', async () => {
      await execGit(root, ['remote', 'add', 'origin', 'https://example.com/repo.git'])

      const result = await removeRemote(pool, { cwd: root, name: 'origin' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data).toEqual([])
    })
  })

  describe('push / pull guards', () => {
    it('rejects a push remote that looks like an option flag', async () => {
      const result = await push(pool, { cwd: root, remote: '--exec=evil', branch: 'main' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toContain('Invalid remote')
    })

    it('rejects a pull branch that looks like an option flag', async () => {
      const result = await pull(pool, { cwd: root, remote: 'origin', branch: '--upload-pack' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toContain('Invalid branch')
    })

    it('surfaces a no-remote style failure when pushing without a destination', async () => {
      await commitFile(root, 'a.txt', 'hello\n')

      const result = await push(pool, { cwd: root })

      // No remote configured → the op fails rather than silently succeeding.
      expect(result.ok).toBe(false)
    })
  })

  describe('init / setUser', () => {
    it('initializes a repo in an empty directory', async () => {
      const fresh = await mkdtemp(join(tmpdir(), 'tanzo-git-init-'))
      try {
        const result = await init(pool, { cwd: fresh, initialBranch: 'main' })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.data.kind).toBe('repository')
      } finally {
        await rm(fresh, { recursive: true, force: true })
      }
    })

    it('sets the local user name and email', async () => {
      const result = await setUser(pool, {
        cwd: root,
        scope: 'local',
        name: 'Ada Lovelace',
        email: 'ada@example.com'
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.name).toBe('Ada Lovelace')
      expect(result.data.email).toBe('ada@example.com')
      // Confirm it landed in the repo-local config, not global.
      expect((await execGit(root, ['config', '--local', 'user.name'])).trim()).toBe('Ada Lovelace')
    })
  })

  it('leaves the working tree consistent across a stage → commit round trip', async () => {
    await writeFile(join(root, 'a.txt'), 'hello\n', 'utf8')
    await stage(pool, { cwd: root, paths: ['a.txt'] })
    await commit(pool, { cwd: root, message: 'add a' })

    const status = await readStatus(pool, root)
    expect(status.ok).toBe(true)
    if (!status.ok) return
    expect(status.data.isClean).toBe(true)
    expect(status.data.head.hasCommits).toBe(true)
  })
})
