import type {
  GitApi,
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
  GitTargetRef,
  GitUserInfo
} from '@shared/git'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

function requireGitApi(): GitApi {
  const gitApi = window.electron?.git
  if (!gitApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_GIT_API_UNAVAILABLE',
      'Electron Git API is not available'
    )
  }
  return withDecodedIpcErrors(gitApi)
}

async function unwrap<T>(promise: Promise<GitResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.message)
  return result.data
}

export interface GitHistoryInputClient extends GitTargetRef {
  readonly limit?: number
}

export interface GitCommitDetailInputClient extends GitTargetRef {
  readonly hash: string
}

export const gitClient = {
  getOverview(input: GitTargetRef): Promise<GitOverview> {
    return unwrap(requireGitApi().getOverview(input))
  },
  getStatus(input: GitTargetRef): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().getStatus(input))
  },
  getDiff(input: GitDiffInput): Promise<GitDiffResult> {
    return unwrap(requireGitApi().getDiff(input))
  },
  listHistory(input: GitHistoryInputClient): Promise<GitHistoryPage> {
    return unwrap(requireGitApi().listHistory(input))
  },
  getCommit(input: GitCommitDetailInputClient): Promise<GitCommitDetails> {
    return unwrap(requireGitApi().getCommit(input))
  },
  listBranches(input: GitTargetRef): Promise<readonly GitBranchInfo[]> {
    return unwrap(requireGitApi().listBranches(input))
  },
  listRemoteBranches(input: GitTargetRef): Promise<readonly GitRemoteBranchInfo[]> {
    return unwrap(requireGitApi().listRemoteBranches(input))
  },
  listRemotes(input: GitTargetRef): Promise<readonly GitRemoteInfo[]> {
    return unwrap(requireGitApi().listRemotes(input))
  },
  getUser(input: GitTargetRef): Promise<GitUserInfo> {
    return unwrap(requireGitApi().getUser(input))
  },
  init(input: GitInitInput): Promise<GitOverview> {
    return unwrap(requireGitApi().init(input))
  },
  stage(input: GitPathsInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().stage(input))
  },
  restoreStaged(input: GitPathsInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().restoreStaged(input))
  },
  restoreWorktree(input: GitPathsInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().restoreWorktree(input))
  },
  discard(input: GitPathsInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().discard(input))
  },
  commit(input: GitCommitInput): Promise<GitCommitResult> {
    return unwrap(requireGitApi().commit(input))
  },
  fetch(input: GitFetchInput): Promise<GitSyncResult> {
    return unwrap(requireGitApi().fetch(input))
  },
  pull(input: GitPullInput): Promise<GitSyncResult> {
    return unwrap(requireGitApi().pull(input))
  },
  push(input: GitPushInput): Promise<GitSyncResult> {
    return unwrap(requireGitApi().push(input))
  },
  checkout(input: GitCheckoutInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().checkout(input))
  },
  checkoutRemoteBranch(input: GitCheckoutRemoteBranchInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().checkoutRemoteBranch(input))
  },
  createBranch(input: GitCreateBranchInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().createBranch(input))
  },
  deleteBranch(input: GitDeleteBranchInput): Promise<GitStatusSnapshot> {
    return unwrap(requireGitApi().deleteBranch(input))
  },
  addRemote(input: GitRemoteAddInput): Promise<readonly GitRemoteInfo[]> {
    return unwrap(requireGitApi().addRemote(input))
  },
  removeRemote(input: GitRemoteRemoveInput): Promise<readonly GitRemoteInfo[]> {
    return unwrap(requireGitApi().removeRemote(input))
  },
  setUser(input: GitSetUserInput): Promise<GitUserInfo> {
    return unwrap(requireGitApi().setUser(input))
  },
  watch(cwd: string): Promise<void> {
    return requireGitApi().watch(cwd)
  },
  unwatch(cwd: string): Promise<void> {
    return requireGitApi().unwatch(cwd)
  },
  onChanged(callback: (event: GitChangedEvent) => void): () => void {
    return requireGitApi().onChanged(callback)
  }
}
