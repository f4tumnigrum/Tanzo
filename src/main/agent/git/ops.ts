import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type {
  GitBranchInfo,
  GitCommitDetails,
  GitCommitFileChange,
  GitDiffInput,
  GitDiffResult,
  GitFileChangeStatus,
  GitHistoryPage,
  GitOverview,
  GitRemoteBranchInfo,
  GitRemoteInfo,
  GitResult,
  GitStatusSnapshot,
  GitUserInfo
} from '@shared/git'
import { fail, ok } from './errors'
import { mapStatusSnapshot, parseNumstat } from './map'

const DIFF_MAX_BYTES = 400_000
const DIFF_EXEC_MAX_BUFFER = 8 * 1024 * 1024

interface ParsedNumstatEntry {
  readonly path: string
  readonly oldPath?: string
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
}

interface ParsedNameStatusEntry {
  readonly path: string
  readonly oldPath?: string
  readonly status: GitFileChangeStatus
}

export interface GitClientPool {
  client(cwd: string): SimpleGit
  isRepo(cwd: string): Promise<boolean>
}

export function createClientPool(): GitClientPool {
  const clients = new Map<string, SimpleGit>()
  return {
    client(cwd) {
      let git = clients.get(cwd)
      if (!git) {
        git = simpleGit({ baseDir: cwd, trimmed: true })
        clients.set(cwd, git)
      }
      return git
    },
    async isRepo(cwd) {
      try {
        return await this.client(cwd).checkIsRepo()
      } catch {
        return false
      }
    }
  }
}

function parseIntSafe(input: string): number {
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseNumstatZ(output: string): ParsedNumstatEntry[] {
  const entries: ParsedNumstatEntry[] = []
  const tokens = output.split('\0').filter((token) => token.length > 0)
  for (let index = 0; index < tokens.length; index += 1) {
    const header = tokens[index] ?? ''
    const [additionsRaw = '0', deletionsRaw = '0', inlinePath] = header.split('\t')
    const binary = additionsRaw === '-' || deletionsRaw === '-'
    if (inlinePath !== undefined && inlinePath.length > 0) {
      entries.push({
        path: inlinePath,
        additions: binary ? 0 : parseIntSafe(additionsRaw),
        deletions: binary ? 0 : parseIntSafe(deletionsRaw),
        binary
      })
      continue
    }
    const oldPath = tokens[index + 1]
    const newPath = tokens[index + 2]
    if (!oldPath || !newPath) continue
    index += 2
    entries.push({
      path: newPath,
      oldPath,
      additions: binary ? 0 : parseIntSafe(additionsRaw),
      deletions: binary ? 0 : parseIntSafe(deletionsRaw),
      binary
    })
  }
  return entries
}

function mapNameStatusCode(code: string): GitFileChangeStatus {
  if (code === 'A') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  if (code === 'C') return 'copied'
  return 'modified'
}

function parseNameStatusZ(output: string): ParsedNameStatusEntry[] {
  const entries: ParsedNameStatusEntry[] = []
  const tokens = output.split('\0').filter((token) => token.length > 0)
  for (let index = 0; index < tokens.length; index += 1) {
    const code = (tokens[index] ?? '').charAt(0)
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[index + 1]
      const newPath = tokens[index + 2]
      if (oldPath && newPath) {
        entries.push({
          path: newPath,
          oldPath,
          status: code === 'R' ? 'renamed' : 'copied'
        })
      }
      index += 2
      continue
    }
    const filePath = tokens[index + 1]
    if (filePath) entries.push({ path: filePath, status: mapNameStatusCode(code) })
    index += 1
  }
  return entries
}

async function readNoIndexDiff(cwd: string, filePath: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tanzo-git-diff-'))
  const emptyPath = path.join(tempDir, 'empty')
  try {
    await writeFile(emptyPath, '', 'utf8')
    const absolutePath = path.resolve(cwd, filePath)
    return await new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        [
          '-c',
          'core.quotepath=false',
          'diff',
          '--no-index',
          '--no-ext-diff',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--',
          emptyPath,
          absolutePath
        ],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: DIFF_EXEC_MAX_BUFFER
        },
        (error, stdout, stderr) => {
          const code = (error as { code?: unknown } | null)?.code
          if (error && code !== 1) {
            reject(Object.assign(error, { stdout, stderr }))
            return
          }
          resolve(stdout ?? '')
        }
      )
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function isUntrackedPath(git: SimpleGit, filePath: string): Promise<boolean> {
  const status = await git.status()
  return status.files.some(
    (file) => file.path === filePath && (file.index === '?' || file.working_dir === '?')
  )
}

async function hasCommits(git: SimpleGit): Promise<boolean> {
  try {
    await git.revparse(['--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

export async function readStatus(
  pool: GitClientPool,
  cwd: string
): Promise<GitResult<GitStatusSnapshot>> {
  try {
    const git = pool.client(cwd)
    const [status, stagedRaw, unstagedRaw, hasHeadCommit] = await Promise.all([
      git.status(),
      git.raw(['diff', '--numstat', '--cached']).catch(() => ''),
      git.raw(['diff', '--numstat']).catch(() => ''),
      hasCommits(git)
    ])
    return ok(
      mapStatusSnapshot(status, parseNumstat(stagedRaw), parseNumstat(unstagedRaw), hasHeadCommit)
    )
  } catch (error) {
    return fail(error)
  }
}

export async function readOverview(
  pool: GitClientPool,
  cwd: string
): Promise<GitResult<GitOverview>> {
  const updatedAt = new Date().toISOString()
  try {
    if (!(await pool.isRepo(cwd))) {
      return ok(emptyOverview(cwd, 'none', updatedAt))
    }
    const git = pool.client(cwd)
    const status = await git.status()
    const root = await git.revparse(['--show-toplevel']).catch(() => null)
    const headSha = await git.revparse(['HEAD']).catch(() => null)
    const staged = status.files.filter((f) => f.index !== ' ' && f.index !== '?').length
    const untracked = status.files.filter((f) => f.index === '?' || f.working_dir === '?').length
    const unstaged = status.files.filter(
      (f) => f.working_dir !== ' ' && f.working_dir !== '?'
    ).length
    const conflicts = status.files.filter((f) => f.index === 'U' || f.working_dir === 'U').length
    return ok({
      cwd,
      repositoryRootPath: root,
      kind: 'repository',
      branch: status.current,
      headSha,
      isDirty: !status.isClean(),
      isDetached: status.detached,
      hasInitialCommit: Boolean(headSha),
      ahead: status.ahead,
      behind: status.behind,
      stagedCount: staged,
      unstagedCount: unstaged,
      untrackedCount: untracked,
      conflictCount: conflicts,
      updatedAt
    })
  } catch (error) {
    const result = fail<GitOverview>(error)
    const message = result.ok ? '' : result.message
    return ok({ ...emptyOverview(cwd, 'error', updatedAt), error: message })
  }
}

function emptyOverview(cwd: string, kind: GitOverview['kind'], updatedAt: string): GitOverview {
  return {
    cwd,
    repositoryRootPath: null,
    kind,
    branch: null,
    headSha: null,
    isDirty: false,
    isDetached: false,
    hasInitialCommit: false,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    updatedAt
  }
}

export async function readDiff(
  pool: GitClientPool,
  input: GitDiffInput
): Promise<GitResult<GitDiffResult>> {
  try {
    const git = pool.client(input.cwd)
    let patch: string
    if (input.scope === 'commit') {
      if (input.hash.startsWith('-') || input.hash.includes('\0')) {
        return fail(new Error(`Invalid commit hash: "${input.hash}".`))
      }
      patch = await git.raw([
        'diff',
        `${input.hash}^!`,
        ...(input.filePath ? ['--', input.filePath] : [])
      ])
    } else if (input.scope === 'staged') {
      patch = await git.raw(['diff', '--staged', '--', input.filePath])
    } else if (await isUntrackedPath(git, input.filePath)) {
      patch = await readNoIndexDiff(input.cwd, input.filePath)
    } else {
      patch = await git.raw(['diff', '--', input.filePath])
    }
    const truncated = patch.length > DIFF_MAX_BYTES
    return ok({
      patch: truncated ? patch.slice(0, DIFF_MAX_BYTES) : patch,
      binary: /^Binary files .* differ$/m.test(patch),
      truncated
    })
  } catch (error) {
    return fail(error)
  }
}

export async function readHistory(
  pool: GitClientPool,
  cwd: string,
  limit = 80
): Promise<GitResult<GitHistoryPage>> {
  try {
    const git = pool.client(cwd)
    if (!(await hasCommits(git))) return ok({ entries: [] })
    const log = await git.log({ maxCount: limit })
    return ok({
      entries: log.all.map((entry) => ({
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        subject: entry.message,
        author: entry.author_name,
        date: entry.date
      }))
    })
  } catch (error) {
    return fail(error)
  }
}

const COMMIT_FORMAT = '%H%n%h%n%an%n%aI%n%s%n%b'

export async function readCommit(
  pool: GitClientPool,
  cwd: string,
  hash: string
): Promise<GitResult<GitCommitDetails>> {
  try {
    if (hash.startsWith('-') || hash.includes('\0')) {
      return fail(new Error(`Invalid commit hash: "${hash}".`))
    }
    const git = pool.client(cwd)
    const raw = await git.raw(['show', '--no-patch', `--format=${COMMIT_FORMAT}`, hash])
    const [fullHash, shortHash, author, date, subject, ...bodyLines] = raw.split('\n')
    const [numstat, nameStatus] = await Promise.all([
      git.raw(['show', '--numstat', '-z', '--format=', '-M', '-C', hash]),
      git.raw(['show', '--name-status', '-z', '--format=', '-M', '-C', hash])
    ])
    const numstatByPath = new Map(parseNumstatZ(numstat).map((entry) => [entry.path, entry]))
    const statusByPath = new Map(parseNameStatusZ(nameStatus).map((entry) => [entry.path, entry]))
    const paths = new Set<string>([...numstatByPath.keys(), ...statusByPath.keys()])
    const files: GitCommitFileChange[] = [...paths]
      .map((filePath) => {
        const stats = numstatByPath.get(filePath)
        const status = statusByPath.get(filePath)
        return {
          path: filePath,
          ...((status?.oldPath ?? stats?.oldPath)
            ? { oldPath: status?.oldPath ?? stats?.oldPath }
            : {}),
          status: status?.status ?? 'modified',
          additions: stats?.additions ?? 0,
          deletions: stats?.deletions ?? 0,
          binary: stats?.binary ?? false
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))
    return ok({
      hash: fullHash ?? hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      subject: subject ?? '',
      body: bodyLines.join('\n').trim(),
      author: author ?? '',
      date: date ?? '',
      files
    })
  } catch (error) {
    return fail(error)
  }
}

const BRANCH_FIELD_SEP = '\x1f'
const BRANCH_REF_FORMAT = [
  '%(refname:short)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)'
].join(BRANCH_FIELD_SEP)

/** Parse `git for-each-ref --format=... refs/heads` output into branch info. */
function parseBranchRefs(raw: string): GitBranchInfo[] {
  const branches: GitBranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [name = '', head = '', upstream = '', track = ''] = line.split(BRANCH_FIELD_SEP)
    if (!name) continue
    const ahead = /ahead (\d+)/.exec(track)
    const behind = /behind (\d+)/.exec(track)
    branches.push({
      name,
      current: head === '*',
      ...(upstream ? { upstream } : {}),
      ahead: ahead ? parseIntSafe(ahead[1] ?? '0') : 0,
      behind: behind ? parseIntSafe(behind[1] ?? '0') : 0
    })
  }
  return branches
}

export async function readBranches(
  pool: GitClientPool,
  cwd: string
): Promise<GitResult<readonly GitBranchInfo[]>> {
  try {
    const git = pool.client(cwd)
    // `for-each-ref` yields name, current marker, upstream and ahead/behind in a
    // single call — the values simple-git's branchLocal() leaves at zero.
    const raw = await git.raw(['for-each-ref', `--format=${BRANCH_REF_FORMAT}`, 'refs/heads'])
    const branches = parseBranchRefs(raw)
    if (branches.length > 0) return ok(branches)
    // Unborn branch (repo with no commits yet): surface the symbolic HEAD name.
    const current = await git.raw(['symbolic-ref', '--short', 'HEAD']).catch(() => '')
    const name = current.trim()
    return ok(name ? [{ name, current: true, ahead: 0, behind: 0 }] : [])
  } catch (error) {
    return fail(error)
  }
}

export async function readRemoteBranches(
  pool: GitClientPool,
  cwd: string
): Promise<GitResult<readonly GitRemoteBranchInfo[]>> {
  try {
    const summary = await pool.client(cwd).branch(['-r'])
    const branches: GitRemoteBranchInfo[] = summary.all.map((name) => {
      const slash = name.indexOf('/')
      return {
        name,
        remote: slash > 0 ? name.slice(0, slash) : '',
        branch: slash > 0 ? name.slice(slash + 1) : name,
        headSha: summary.branches[name]?.commit ?? null
      }
    })
    return ok(branches)
  } catch (error) {
    return fail(error)
  }
}

export async function readRemotes(
  pool: GitClientPool,
  cwd: string
): Promise<GitResult<readonly GitRemoteInfo[]>> {
  try {
    const remotes = await pool.client(cwd).getRemotes(true)
    return ok(
      remotes.map((remote) => ({
        name: remote.name,
        fetchUrl: remote.refs.fetch ?? '',
        pushUrl: remote.refs.push ?? remote.refs.fetch ?? ''
      }))
    )
  } catch (error) {
    return fail(error)
  }
}

export async function readUser(pool: GitClientPool, cwd: string): Promise<GitResult<GitUserInfo>> {
  try {
    const git = pool.client(cwd)
    const name = await git.raw(['config', 'user.name']).catch(() => '')
    const email = await git.raw(['config', 'user.email']).catch(() => '')
    return ok({ name: name.trim() || null, email: email.trim() || null })
  } catch (error) {
    return fail(error)
  }
}
