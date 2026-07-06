import type {
  GitCheckoutInput,
  GitCheckoutRemoteBranchInput,
  GitCommitInput,
  GitCommitResult,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFetchInput,
  GitInitInput,
  GitOverview,
  GitPathsInput,
  GitPullInput,
  GitPushInput,
  GitRemoteAddInput,
  GitRemoteInfo,
  GitRemoteRemoveInput,
  GitResult,
  GitSetUserInput,
  GitStatusSnapshot,
  GitSyncKind,
  GitSyncResult,
  GitUserInfo
} from '@shared/git'
import type { SimpleGit } from 'simple-git'
import { fail, ok } from './errors'
import { readOverview, readRemotes, readStatus, readUser, type GitClientPool } from './ops'

function assertNotOption(value: string, label: string): void {
  if (value.startsWith('-') || value.includes('\0')) {
    throw new Error(`Invalid ${label}: "${value}".`)
  }
}

const ALLOWED_REMOTE_SCHEMES = new Set(['https:', 'ssh:', 'git:', 'http:', 'file:'])

function assertSafeRemoteUrl(url: string): void {
  assertNotOption(url, 'remote url')
  let scheme: string | null = null
  try {
    scheme = new URL(url).protocol
  } catch {
    if (/^[\w.-]+@[\w.-]+:/.test(url)) return
    throw new Error(`Invalid remote url: "${url}".`)
  }
  if (!ALLOWED_REMOTE_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported remote url scheme: "${scheme}".`)
  }
}

export async function stage(
  pool: GitClientPool,
  input: GitPathsInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    if (input.paths.length === 0) return readStatus(pool, input.cwd)
    await pool.client(input.cwd).add([...input.paths])
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function restoreStaged(
  pool: GitClientPool,
  input: GitPathsInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    if (input.paths.length === 0) return readStatus(pool, input.cwd)
    await pool.client(input.cwd).reset(['--', ...input.paths])
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function restoreWorktree(
  pool: GitClientPool,
  input: GitPathsInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    if (input.paths.length === 0) return readStatus(pool, input.cwd)
    await pool.client(input.cwd).checkout(['--', ...input.paths])
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

/**
 * Partition the requested paths into tracked vs. untracked so `discard` can
 * apply the right recovery per path. Running `git checkout -- <path>` over an
 * untracked path aborts the whole batch, which previously left tracked files
 * un-reverted when the two kinds were mixed.
 */
async function partitionTracked(
  git: SimpleGit,
  paths: readonly string[]
): Promise<{ tracked: string[]; untracked: string[] }> {
  const status = await git.status()
  const untrackedSet = new Set(
    status.files
      .filter((file) => file.index === '?' || file.working_dir === '?')
      .map((file) => file.path)
  )
  const tracked: string[] = []
  const untracked: string[] = []
  for (const path of paths) {
    if (untrackedSet.has(path)) untracked.push(path)
    else tracked.push(path)
  }
  return { tracked, untracked }
}

export async function discard(
  pool: GitClientPool,
  input: GitPathsInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    if (input.paths.length === 0) return readStatus(pool, input.cwd)
    const git = pool.client(input.cwd)
    const { tracked, untracked } = await partitionTracked(git, input.paths)
    if (tracked.length > 0) {
      // Unstage then restore the worktree copy from HEAD for tracked paths.
      await git.reset(['--', ...tracked]).catch(() => undefined)
      await git.checkout(['--', ...tracked])
    }
    if (untracked.length > 0) {
      await git.clean('f', ['--', ...untracked])
    }
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function commit(
  pool: GitClientPool,
  input: GitCommitInput
): Promise<GitResult<GitCommitResult>> {
  try {
    const options: string[] = []
    if (input.amend) options.push('--amend')
    if (input.noEdit) options.push('--no-edit')
    if (input.signoff) options.push('--signoff')
    const result = await pool.client(input.cwd).commit(input.message ?? '', options)
    return ok({
      hash: result.commit,
      message: input.message ?? '',
      branch: result.branch
    })
  } catch (error) {
    return fail(error)
  }
}

async function headSha(git: SimpleGit): Promise<string | null> {
  return git.revparse(['HEAD']).catch(() => null)
}

/** Count commits reachable from `to` but not from `from` (0 when unknown). */
async function countBetween(git: SimpleGit, from: string, to: string): Promise<number> {
  if (from === to) return 0
  const raw = await git.raw(['rev-list', '--count', `${from}..${to}`]).catch(() => '0')
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Run a fetch/pull/push, then diff HEAD and ahead/behind before/after so the UI
 * can report a real outcome. `received` = local HEAD advanced (pull); `published`
 * = commits the remote gained (push, i.e. the ahead count we consumed).
 */
async function runSync(
  pool: GitClientPool,
  cwd: string,
  kind: GitSyncKind,
  run: (git: SimpleGit) => Promise<unknown>
): Promise<GitResult<GitSyncResult>> {
  try {
    const git = pool.client(cwd)
    const beforeHead = await headSha(git)
    const beforeStatus = await readStatus(pool, cwd)
    const beforeAhead = beforeStatus.ok ? beforeStatus.data.head.ahead : 0
    await run(git)
    const status = await readStatus(pool, cwd)
    if (!status.ok) return status
    const afterHead = await headSha(git)
    const received = beforeHead && afterHead ? await countBetween(git, beforeHead, afterHead) : 0
    const published = kind === 'push' ? Math.max(0, beforeAhead - status.data.head.ahead) : 0
    const hasConflicts = status.data.hasConflicts
    const noop = !hasConflicts && received === 0 && published === 0
    return ok({ kind, snapshot: status.data, received, published, hasConflicts, noop })
  } catch (error) {
    return fail(error)
  }
}

export async function fetch(
  pool: GitClientPool,
  input: GitFetchInput
): Promise<GitResult<GitSyncResult>> {
  if (input.remote) {
    try {
      assertNotOption(input.remote, 'remote')
    } catch (error) {
      return fail(error)
    }
  }
  return runSync(pool, input.cwd, 'fetch', (git) => git.fetch(input.remote ? [input.remote] : []))
}

export async function pull(
  pool: GitClientPool,
  input: GitPullInput
): Promise<GitResult<GitSyncResult>> {
  if (input.remote && input.branch) {
    try {
      assertNotOption(input.remote, 'remote')
      assertNotOption(input.branch, 'branch')
    } catch (error) {
      return fail(error)
    }
  }
  return runSync(pool, input.cwd, 'pull', (git) =>
    input.remote && input.branch ? git.pull(input.remote, input.branch) : git.pull()
  )
}

export async function push(
  pool: GitClientPool,
  input: GitPushInput
): Promise<GitResult<GitSyncResult>> {
  const options: string[] = []
  if (input.forceWithLease) {
    options.push(input.lease ? `--force-with-lease=${input.lease}` : '--force-with-lease')
  }
  if (input.remote && input.branch) {
    try {
      assertNotOption(input.remote, 'remote')
      assertNotOption(input.branch, 'branch')
    } catch (error) {
      return fail(error)
    }
  }
  return runSync(pool, input.cwd, 'push', (git) =>
    input.remote && input.branch ? git.push(input.remote, input.branch, options) : git.push(options)
  )
}

export async function checkout(
  pool: GitClientPool,
  input: GitCheckoutInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    assertNotOption(input.ref, 'ref')
    await pool.client(input.cwd).checkout(input.ref)
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function checkoutRemoteBranch(
  pool: GitClientPool,
  input: GitCheckoutRemoteBranchInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    assertNotOption(input.remoteBranch, 'remote branch')
    const local = input.localBranch ?? input.remoteBranch.split('/').slice(1).join('/')
    assertNotOption(local, 'branch')
    await pool.client(input.cwd).checkout(['-b', local, '--track', input.remoteBranch])
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function createBranch(
  pool: GitClientPool,
  input: GitCreateBranchInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    assertNotOption(input.name, 'branch')
    if (input.startPoint) assertNotOption(input.startPoint, 'start point')
    const args = ['-b', input.name, ...(input.startPoint ? [input.startPoint] : [])]
    await pool.client(input.cwd).checkout(args)
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function deleteBranch(
  pool: GitClientPool,
  input: GitDeleteBranchInput
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    assertNotOption(input.name, 'branch')
    await pool.client(input.cwd).deleteLocalBranch(input.name, input.force ?? false)
    return readStatus(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function addRemote(
  pool: GitClientPool,
  input: GitRemoteAddInput
): Promise<GitResult<readonly GitRemoteInfo[]>> {
  try {
    assertNotOption(input.name, 'remote')
    assertSafeRemoteUrl(input.url)
    const git = pool.client(input.cwd)
    await git.addRemote(input.name, input.url)
    if (input.fetch) await git.fetch(input.name)
    return readRemotes(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function removeRemote(
  pool: GitClientPool,
  input: GitRemoteRemoveInput
): Promise<GitResult<readonly GitRemoteInfo[]>> {
  try {
    await pool.client(input.cwd).removeRemote(input.name)
    return readRemotes(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function init(
  pool: GitClientPool,
  input: GitInitInput
): Promise<GitResult<GitOverview>> {
  try {
    const args = input.initialBranch ? ['-b', input.initialBranch] : []
    await pool.client(input.cwd).init(args)
    return readOverview(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}

export async function setUser(
  pool: GitClientPool,
  input: GitSetUserInput
): Promise<GitResult<GitUserInfo>> {
  try {
    const git = pool.client(input.cwd)
    const scopeArg = input.scope === 'global' ? ['--global'] : []
    await git.raw(['config', ...scopeArg, 'user.name', input.name])
    await git.raw(['config', ...scopeArg, 'user.email', input.email])
    return readUser(pool, input.cwd)
  } catch (error) {
    return fail(error)
  }
}
