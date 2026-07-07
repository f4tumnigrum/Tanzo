import { useQuery } from '@tanstack/react-query'
import i18n from '@/i18n'
import { gitClient } from '@/platform/electron/git-client'
import type {
  GitBranchInfo,
  GitCommitDetails,
  GitDiffResult,
  GitHistoryPage,
  GitOverview,
  GitRemoteBranchInfo,
  GitRemoteInfo,
  GitStatusSnapshot,
  GitTargetRef,
  GitUserInfo
} from '@shared/git'
import { gitKeys } from './git-query-keys'
import {
  resolveCommitFile,
  resolveCommitHash,
  resolveSelectedFile,
  type GitReviewSelectedFile
} from './git-selection'

export const HISTORY_PAGE_SIZE = 80

export interface GitIntent {
  readonly file: GitReviewSelectedFile | null
  readonly commitHash: string | null
  readonly commitFile: string | null
  readonly historyLimit: number
}

export interface GitQueries {
  readonly cwd: string
  readonly isRepository: boolean
  readonly overview: GitOverview | null
  readonly status: GitStatusSnapshot | null
  readonly history: GitHistoryPage | null
  readonly hasMoreHistory: boolean
  readonly historyLoading: boolean
  readonly branches: readonly GitBranchInfo[]
  readonly remoteBranches: readonly GitRemoteBranchInfo[]
  readonly remotes: readonly GitRemoteInfo[]
  readonly user: GitUserInfo | null
  readonly commitDetails: GitCommitDetails | null
  readonly diff: GitDiffResult | null
  readonly commitDiff: GitDiffResult | null
  readonly selectedFile: GitReviewSelectedFile | null
  readonly selectedCommitHash: string | null
  readonly selectedCommitFile: string | null
  readonly loading: boolean
  readonly diffLoading: boolean
  readonly commitLoading: boolean
  readonly commitDiffLoading: boolean
  readonly error: string | null
}

function errorText(error: unknown, fallbackKey: string): string | null {
  if (!error) return null
  return error instanceof Error ? error.message : i18n.t(fallbackKey)
}

export function useGitQueries(target: GitTargetRef | null, intent: GitIntent): GitQueries {
  const cwd = target?.cwd ?? ''
  const hasTarget = Boolean(target)

  const overview = useQuery({
    queryKey: gitKeys.overview(cwd),
    queryFn: () => gitClient.getOverview(target as GitTargetRef),
    enabled: hasTarget
  })

  const isRepository = overview.data?.kind === 'repository'
  const repoEnabled = hasTarget && isRepository

  const status = useQuery({
    queryKey: gitKeys.status(cwd),
    queryFn: () => gitClient.getStatus(target as GitTargetRef),
    enabled: repoEnabled
  })
  const history = useQuery({
    queryKey: gitKeys.history(cwd, intent.historyLimit),
    queryFn: () =>
      gitClient.listHistory({ ...(target as GitTargetRef), limit: intent.historyLimit }),
    enabled: repoEnabled
  })
  const branches = useQuery({
    queryKey: gitKeys.branches(cwd),
    queryFn: () => gitClient.listBranches(target as GitTargetRef),
    enabled: repoEnabled
  })
  const remoteBranches = useQuery({
    queryKey: gitKeys.remoteBranches(cwd),
    queryFn: () => gitClient.listRemoteBranches(target as GitTargetRef),
    enabled: repoEnabled
  })
  const remotes = useQuery({
    queryKey: gitKeys.remotes(cwd),
    queryFn: () => gitClient.listRemotes(target as GitTargetRef),
    enabled: repoEnabled
  })
  const user = useQuery({
    queryKey: gitKeys.user(cwd),
    queryFn: () => gitClient.getUser(target as GitTargetRef),
    enabled: repoEnabled
  })

  const statusData = repoEnabled ? (status.data ?? null) : null
  const historyData = repoEnabled ? (history.data ?? null) : null
  const selectedFile = resolveSelectedFile(intent.file, statusData)
  const selectedCommitHash = resolveCommitHash(intent.commitHash, historyData)

  const commitDetails = useQuery({
    queryKey: gitKeys.commit(cwd, selectedCommitHash ?? ''),
    queryFn: () => gitClient.getCommit({ cwd, hash: selectedCommitHash as string }),
    enabled: repoEnabled && Boolean(selectedCommitHash)
  })

  const commitDetailsData = repoEnabled && selectedCommitHash ? (commitDetails.data ?? null) : null
  const selectedCommitFile = resolveCommitFile(intent.commitFile, commitDetailsData)

  const diff = useQuery({
    queryKey: gitKeys.diff(cwd, selectedFile?.scope ?? '', selectedFile?.path ?? ''),
    queryFn: () =>
      gitClient.getDiff({
        cwd,
        scope: (selectedFile as GitReviewSelectedFile).scope,
        filePath: (selectedFile as GitReviewSelectedFile).path
      }),
    enabled: repoEnabled && Boolean(selectedFile)
  })

  const commitDiff = useQuery({
    queryKey: gitKeys.commitDiff(cwd, selectedCommitHash ?? '', selectedCommitFile ?? ''),
    queryFn: () =>
      gitClient.getDiff({
        cwd,
        scope: 'commit',
        hash: selectedCommitHash as string,
        filePath: selectedCommitFile as string
      }),
    enabled: repoEnabled && Boolean(selectedCommitHash) && Boolean(selectedCommitFile)
  })

  return {
    cwd,
    isRepository,
    overview: overview.data ?? null,
    status: statusData,
    history: historyData,
    hasMoreHistory: (historyData?.entries.length ?? 0) >= intent.historyLimit,
    historyLoading: history.isFetching,
    branches: repoEnabled ? (branches.data ?? []) : [],
    remoteBranches: repoEnabled ? (remoteBranches.data ?? []) : [],
    remotes: repoEnabled ? (remotes.data ?? []) : [],
    user: repoEnabled ? (user.data ?? null) : null,
    commitDetails: commitDetailsData,
    diff: selectedFile ? (diff.data ?? null) : null,
    commitDiff: selectedCommitHash && selectedCommitFile ? (commitDiff.data ?? null) : null,
    selectedFile,
    selectedCommitHash,
    selectedCommitFile,
    loading:
      overview.isFetching ||
      status.isFetching ||
      history.isFetching ||
      branches.isFetching ||
      remoteBranches.isFetching ||
      remotes.isFetching ||
      user.isFetching,
    diffLoading: diff.isFetching,
    commitLoading: commitDetails.isFetching,
    commitDiffLoading: commitDiff.isFetching,
    error:
      errorText(overview.error, 'gitReview.errors.refreshStatus') ??
      errorText(status.error, 'gitReview.errors.refreshStatus') ??
      errorText(history.error, 'gitReview.errors.refreshStatus') ??
      errorText(branches.error, 'gitReview.errors.refreshStatus') ??
      errorText(remoteBranches.error, 'gitReview.errors.refreshStatus') ??
      errorText(remotes.error, 'gitReview.errors.refreshStatus') ??
      errorText(user.error, 'gitReview.errors.refreshStatus') ??
      errorText(diff.error, 'gitReview.errors.loadFileDiff') ??
      errorText(commitDetails.error, 'gitReview.errors.loadCommitDetails') ??
      errorText(commitDiff.error, 'gitReview.errors.loadCommitDiff')
  }
}
