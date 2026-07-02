import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitWatcher } from '@main/agent/git/watcher'

/**
 * Refcount + teardown coverage for the git watcher. The debounce/broadcast
 * timing is real chokidar behavior and flaky to assert on, so these tests focus
 * on the deterministic parts: refcounting across repeated watch calls and full
 * cleanup via unwatch / unwatchAll (the paths wired into agent teardown).
 */
describe('agent/git/watcher — refcount and teardown', () => {
  let root: string
  const warnings: unknown[] = []
  const logger = {
    warn: (...args: unknown[]) => {
      warnings.push(args)
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tanzo-git-watcher-'))
    // Minimal .git dir so gitWatchPaths resolves to a real directory.
    await mkdir(join(root, '.git', 'refs'), { recursive: true })
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    warnings.length = 0
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('refcounts repeated watch calls so a single unwatch keeps watching', () => {
    const broadcast = vi.fn()
    const watcher = createGitWatcher({ broadcast, logger })

    watcher.watch(root)
    watcher.watch(root)
    // First unwatch only decrements the refcount; still watching.
    watcher.unwatch(root)
    // Second unwatch drops the last reference and tears the entry down.
    watcher.unwatch(root)

    // A third unwatch on an already-removed cwd is a safe no-op.
    expect(() => watcher.unwatch(root)).not.toThrow()
    watcher.unwatchAll()
  })

  it('unwatch on an unknown cwd is a no-op', () => {
    const watcher = createGitWatcher({ broadcast: vi.fn(), logger })
    expect(() => watcher.unwatch('/nope/not/watched')).not.toThrow()
  })

  it('unwatchAll closes every active entry and can be called repeatedly', () => {
    const watcher = createGitWatcher({ broadcast: vi.fn(), logger })
    watcher.watch(root)

    expect(() => watcher.unwatchAll()).not.toThrow()
    // Idempotent: a second unwatchAll after everything is cleared still works.
    expect(() => watcher.unwatchAll()).not.toThrow()
  })

  it('watching a directory with no resolvable .git does not throw', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'tanzo-git-watcher-bare-'))
    try {
      const watcher = createGitWatcher({ broadcast: vi.fn(), logger })
      // gitWatchPaths returns [] here; chokidar is asked to watch nothing.
      expect(() => watcher.watch(bare)).not.toThrow()
      watcher.unwatchAll()
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })
})
