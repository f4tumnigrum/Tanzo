import type {
  GitBranchInfo,
  GitChangedEvent,
  GitCheckoutInput,
  GitCheckoutRemoteBranchInput,
  GitCommitDetails,
  GitCommitInput,
  GitCommitResult,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitDiffInput,
  GitDiffResult,
  GitFetchInput,
  GitHistoryPage,
  GitInitInput,
  GitOverview,
  GitPathsInput,
  GitPullInput,
  GitPushInput,
  GitRemoteAddInput,
  GitRemoteBranchInfo,
  GitRemoteInfo,
  GitRemoteRemoveInput,
  GitResult,
  GitSetUserInput,
  GitStatusSnapshot,
  GitSyncResult,
  GitUserInfo
} from '@shared/git'
import type { createLogger } from '../../logger'
import {
  createClientPool,
  readBranches,
  readCommit,
  readDiff,
  readHistory,
  readOverview,
  readRemoteBranches,
  readRemotes,
  readStatus,
  readUser
} from './ops'
import {
  addRemote,
  checkout,
  checkoutRemoteBranch,
  commit,
  createBranch,
  deleteBranch,
  discard,
  fetch,
  init,
  pull,
  push,
  removeRemote,
  restoreStaged,
  restoreWorktree,
  setUser,
  stage
} from './ops-write'
import { createGitWatcher } from './watcher'

type ScopedLogger = ReturnType<typeof createLogger>

export interface GitService {
  getOverview(cwd: string): Promise<GitResult<GitOverview>>
  getStatus(cwd: string): Promise<GitResult<GitStatusSnapshot>>
  getDiff(input: GitDiffInput): Promise<GitResult<GitDiffResult>>
  listHistory(cwd: string, limit?: number): Promise<GitResult<GitHistoryPage>>
  getCommit(cwd: string, hash: string): Promise<GitResult<GitCommitDetails>>
  listBranches(cwd: string): Promise<GitResult<readonly GitBranchInfo[]>>
  listRemoteBranches(cwd: string): Promise<GitResult<readonly GitRemoteBranchInfo[]>>
  listRemotes(cwd: string): Promise<GitResult<readonly GitRemoteInfo[]>>
  getUser(cwd: string): Promise<GitResult<GitUserInfo>>
  init(input: GitInitInput): Promise<GitResult<GitOverview>>
  stage(input: GitPathsInput): Promise<GitResult<GitStatusSnapshot>>
  restoreStaged(input: GitPathsInput): Promise<GitResult<GitStatusSnapshot>>
  restoreWorktree(input: GitPathsInput): Promise<GitResult<GitStatusSnapshot>>
  discard(input: GitPathsInput): Promise<GitResult<GitStatusSnapshot>>
  commit(input: GitCommitInput): Promise<GitResult<GitCommitResult>>
  fetch(input: GitFetchInput): Promise<GitResult<GitSyncResult>>
  pull(input: GitPullInput): Promise<GitResult<GitSyncResult>>
  push(input: GitPushInput): Promise<GitResult<GitSyncResult>>
  checkout(input: GitCheckoutInput): Promise<GitResult<GitStatusSnapshot>>
  checkoutRemoteBranch(input: GitCheckoutRemoteBranchInput): Promise<GitResult<GitStatusSnapshot>>
  createBranch(input: GitCreateBranchInput): Promise<GitResult<GitStatusSnapshot>>
  deleteBranch(input: GitDeleteBranchInput): Promise<GitResult<GitStatusSnapshot>>
  addRemote(input: GitRemoteAddInput): Promise<GitResult<readonly GitRemoteInfo[]>>
  removeRemote(input: GitRemoteRemoveInput): Promise<GitResult<readonly GitRemoteInfo[]>>
  setUser(input: GitSetUserInput): Promise<GitResult<GitUserInfo>>
  watch(cwd: string): void
  unwatch(cwd: string): void
  unwatchAll(): void
}

export interface GitServiceOptions {
  broadcast: (event: GitChangedEvent) => void
  logger: ScopedLogger
}

export function createGitService(options: GitServiceOptions): GitService {
  const pool = createClientPool()
  const watcher = createGitWatcher({
    broadcast: (cwd) => options.broadcast({ cwd }),
    logger: options.logger
  })

  return {
    getOverview: (cwd) => readOverview(pool, cwd),
    getStatus: (cwd) => readStatus(pool, cwd),
    getDiff: (input) => readDiff(pool, input),
    listHistory: (cwd, limit) => readHistory(pool, cwd, limit),
    getCommit: (cwd, hash) => readCommit(pool, cwd, hash),
    listBranches: (cwd) => readBranches(pool, cwd),
    listRemoteBranches: (cwd) => readRemoteBranches(pool, cwd),
    listRemotes: (cwd) => readRemotes(pool, cwd),
    getUser: (cwd) => readUser(pool, cwd),
    init: (input) => init(pool, input),
    stage: (input) => stage(pool, input),
    restoreStaged: (input) => restoreStaged(pool, input),
    restoreWorktree: (input) => restoreWorktree(pool, input),
    discard: (input) => discard(pool, input),
    commit: (input) => commit(pool, input),
    fetch: (input) => fetch(pool, input),
    pull: (input) => pull(pool, input),
    push: (input) => push(pool, input),
    checkout: (input) => checkout(pool, input),
    checkoutRemoteBranch: (input) => checkoutRemoteBranch(pool, input),
    createBranch: (input) => createBranch(pool, input),
    deleteBranch: (input) => deleteBranch(pool, input),
    addRemote: (input) => addRemote(pool, input),
    removeRemote: (input) => removeRemote(pool, input),
    setUser: (input) => setUser(pool, input),
    watch: watcher.watch,
    unwatch: watcher.unwatch,
    unwatchAll: watcher.unwatchAll
  }
}
