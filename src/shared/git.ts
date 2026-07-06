export const GIT_CHANNELS = {
  overview: 'git:overview',
  status: 'git:status',
  diff: 'git:diff',
  history: 'git:history',
  commitDetail: 'git:commit-detail',
  branches: 'git:branches',
  remoteBranches: 'git:remote-branches',
  remotes: 'git:remotes',
  user: 'git:user',
  init: 'git:init',
  stage: 'git:stage',
  restoreStaged: 'git:restore-staged',
  restoreWorktree: 'git:restore-worktree',
  discard: 'git:discard',
  commit: 'git:commit',
  fetch: 'git:fetch',
  pull: 'git:pull',
  push: 'git:push',
  checkout: 'git:checkout',
  checkoutRemote: 'git:checkout-remote',
  createBranch: 'git:create-branch',
  deleteBranch: 'git:delete-branch',
  addRemote: 'git:add-remote',
  removeRemote: 'git:remove-remote',
  setUser: 'git:set-user',
  watch: 'git:watch',
  unwatch: 'git:unwatch'
} as const

export type GitChannel = (typeof GIT_CHANNELS)[keyof typeof GIT_CHANNELS]

export const gitEventChannel = (): string => 'git:event'

export interface GitTargetRef {
  readonly cwd: string
}

export type GitRepositoryKind = 'none' | 'repository' | 'error'

export type GitFileChangeStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'binary'

export interface GitHeadInfo {
  readonly ref: string | null
  readonly detached: boolean
  readonly upstream?: string
  readonly ahead: number
  readonly behind: number
  readonly hasCommits: boolean
}

export interface GitBranchInfo {
  readonly name: string
  readonly current: boolean
  readonly upstream?: string
  readonly ahead: number
  readonly behind: number
}

export interface GitRemoteInfo {
  readonly name: string
  readonly fetchUrl: string
  readonly pushUrl: string
}

export interface GitRemoteBranchInfo {
  readonly name: string
  readonly remote: string
  readonly branch: string
  readonly headSha: string | null
}

export interface GitStatusFileScope {
  readonly status: GitFileChangeStatus
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
  readonly diffAvailable: boolean
}

export interface GitStatusEntry {
  readonly path: string
  readonly oldPath?: string
  readonly untracked: boolean
  readonly conflicted: boolean
  readonly staged?: GitStatusFileScope
  readonly unstaged?: GitStatusFileScope
}

export interface GitStatusSnapshot {
  readonly head: GitHeadInfo
  readonly isClean: boolean
  readonly hasConflicts: boolean
  readonly entries: readonly GitStatusEntry[]
}

export interface GitOverview {
  readonly cwd: string
  readonly repositoryRootPath: string | null
  readonly kind: GitRepositoryKind
  readonly branch: string | null
  readonly headSha: string | null
  readonly isDirty: boolean
  readonly isDetached: boolean
  readonly hasInitialCommit: boolean
  readonly ahead: number
  readonly behind: number
  readonly stagedCount: number
  readonly unstagedCount: number
  readonly untrackedCount: number
  readonly conflictCount: number
  readonly updatedAt: string
  readonly error?: string
}

export type GitDiffScope = 'staged' | 'unstaged' | 'commit'

export type GitDiffInput =
  | (GitTargetRef & { readonly scope: 'staged' | 'unstaged'; readonly filePath: string })
  | (GitTargetRef & { readonly scope: 'commit'; readonly hash: string; readonly filePath?: string })

export interface GitDiffResult {
  readonly patch: string
  readonly binary: boolean
  readonly truncated: boolean
}

export interface GitPathsInput extends GitTargetRef {
  readonly paths: readonly string[]
}

export interface GitCommitInput extends GitTargetRef {
  readonly message?: string
  readonly amend?: boolean
  readonly noEdit?: boolean
  readonly signoff?: boolean
}

export interface GitFetchInput extends GitTargetRef {
  readonly remote?: string
}

export interface GitPullInput extends GitTargetRef {
  readonly remote?: string
  readonly branch?: string
}

export interface GitPushInput extends GitTargetRef {
  readonly remote?: string
  readonly branch?: string
  readonly forceWithLease?: boolean
  readonly lease?: string
}

export interface GitCheckoutInput extends GitTargetRef {
  readonly ref: string
}

export interface GitCheckoutRemoteBranchInput extends GitTargetRef {
  readonly remoteBranch: string
  readonly localBranch?: string
}

export interface GitCreateBranchInput extends GitTargetRef {
  readonly name: string
  readonly startPoint?: string
}

export interface GitDeleteBranchInput extends GitTargetRef {
  readonly name: string
  readonly force?: boolean
}

export interface GitRemoteAddInput extends GitTargetRef {
  readonly name: string
  readonly url: string
  readonly fetch?: boolean
}

export interface GitRemoteRemoveInput extends GitTargetRef {
  readonly name: string
}

export interface GitInitInput extends GitTargetRef {
  readonly initialBranch?: string
}

export interface GitHistoryInput extends GitTargetRef {
  readonly limit?: number
}

export interface GitLogEntry {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly author: string
  readonly date: string
}

export interface GitHistoryPage {
  readonly entries: readonly GitLogEntry[]
}

export interface GitCommitDetailInput extends GitTargetRef {
  readonly hash: string
}

export interface GitCommitFileChange {
  readonly path: string
  readonly oldPath?: string
  readonly status: GitFileChangeStatus
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
}

export interface GitCommitDetails {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly body: string
  readonly author: string
  readonly date: string
  readonly files: readonly GitCommitFileChange[]
}

export interface GitUserInfo {
  readonly name: string | null
  readonly email: string | null
}

export interface GitSetUserInput extends GitTargetRef {
  readonly name: string
  readonly email: string
  readonly scope?: 'local' | 'global'
}

export interface GitCommitResult {
  readonly hash: string
  readonly message: string
  readonly branch: string
}

export type GitSyncKind = 'fetch' | 'pull' | 'push'

/**
 * Outcome of a fetch/pull/push. Carries the refreshed status snapshot plus a
 * structured summary so the UI can give real positive feedback ("pulled 3
 * commits", "already up to date", "created conflicts") instead of silence.
 */
export interface GitSyncResult {
  readonly kind: GitSyncKind
  readonly snapshot: GitStatusSnapshot
  /** Commits the local branch moved forward by (pull/fetch), if determinable. */
  readonly received: number
  /** Commits published to the remote (push), if determinable. */
  readonly published: number
  /** True when the operation left conflicts in the working tree. */
  readonly hasConflicts: boolean
  /** True when nothing changed (already up to date / nothing to push). */
  readonly noop: boolean
}

export interface GitChangedEvent {
  readonly cwd: string
}

export type GitErrorCode =
  'not-a-repo' | 'no-remote' | 'no-upstream' | 'nothing-to-commit' | 'conflict' | 'git-failed'

export type GitResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: GitErrorCode; readonly message: string }

export interface GitApi {
  getOverview(input: GitTargetRef): Promise<GitResult<GitOverview>>
  getStatus(input: GitTargetRef): Promise<GitResult<GitStatusSnapshot>>
  getDiff(input: GitDiffInput): Promise<GitResult<GitDiffResult>>
  listHistory(input: GitHistoryInput): Promise<GitResult<GitHistoryPage>>
  getCommit(input: GitCommitDetailInput): Promise<GitResult<GitCommitDetails>>
  listBranches(input: GitTargetRef): Promise<GitResult<readonly GitBranchInfo[]>>
  listRemoteBranches(input: GitTargetRef): Promise<GitResult<readonly GitRemoteBranchInfo[]>>
  listRemotes(input: GitTargetRef): Promise<GitResult<readonly GitRemoteInfo[]>>
  getUser(input: GitTargetRef): Promise<GitResult<GitUserInfo>>
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
  watch(cwd: string): Promise<void>
  unwatch(cwd: string): Promise<void>
  onChanged(callback: (event: GitChangedEvent) => void): () => void
}
