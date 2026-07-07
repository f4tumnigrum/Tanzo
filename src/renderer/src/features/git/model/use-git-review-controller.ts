import { useCallback, useEffect, useMemo, useState } from 'react'
import { gitClient } from '@/platform/electron/git-client'
import type {
  GitBranchInfo,
  GitCommitDetails,
  GitCommitInput,
  GitDiffResult,
  GitHistoryPage,
  GitOverview,
  GitPushInput,
  GitRemoteBranchInfo,
  GitRemoteInfo,
  GitStatusEntry,
  GitStatusSnapshot,
  GitTargetRef,
  GitUserInfo
} from '@shared/git'
import {
  computeCounts,
  selectedEntryFor,
  type GitReviewCounts,
  type GitReviewSelectedFile
} from './git-selection'
import { HISTORY_PAGE_SIZE, useGitQueries } from './use-git-queries'
import { useGitMutations, type GitActionKind } from './use-git-mutations'

export type { GitActionKind }

type GitMutationOptions<T> = Omit<T, 'cwd'>

export type { GitReviewSelectedFile }

export interface GitReviewController {
  readonly target: GitTargetRef | null
  readonly overview: GitOverview | null
  readonly status: GitStatusSnapshot | null
  readonly history: GitHistoryPage | null
  readonly hasMoreHistory: boolean
  readonly historyLoading: boolean
  readonly loadMoreHistory: () => void
  readonly branches: readonly GitBranchInfo[]
  readonly remoteBranches: readonly GitRemoteBranchInfo[]
  readonly remotes: readonly GitRemoteInfo[]
  readonly worktrees: readonly never[]
  readonly user: GitUserInfo | null
  readonly selectedFile: GitReviewSelectedFile | null
  readonly selectedEntry: GitStatusEntry | null
  readonly selectedCommitHash: string | null
  readonly selectedCommitFile: string | null
  readonly commitDetails: GitCommitDetails | null
  readonly diff: GitDiffResult | null
  readonly commitDiff: GitDiffResult | null
  readonly commitMessage: string
  readonly loading: boolean
  readonly diffLoading: boolean
  readonly commitLoading: boolean
  readonly commitDiffLoading: boolean
  readonly mutating: boolean
  readonly pendingAction: GitActionKind | null
  readonly isPending: (action: GitActionKind) => boolean
  readonly error: string | null
  readonly counts: GitReviewCounts
  readonly setSelectedFile: (file: GitReviewSelectedFile | null) => void
  readonly setSelectedCommitHash: (hash: string | null) => void
  readonly setSelectedCommitFile: (path: string | null) => void
  readonly setCommitMessage: (message: string) => void
  readonly refresh: () => Promise<void>
  readonly initRepository: (initialBranch?: string) => Promise<boolean>
  readonly stageFile: (path: string) => Promise<boolean>
  readonly stageFiles: (paths: readonly string[]) => Promise<boolean>
  readonly unstageFile: (path: string) => Promise<boolean>
  readonly unstageFiles: (paths: readonly string[]) => Promise<boolean>
  readonly restoreFile: (path: string) => Promise<boolean>
  readonly restoreFiles: (paths: readonly string[]) => Promise<boolean>
  readonly discardFile: (path: string) => Promise<boolean>
  readonly discardFiles: (paths: readonly string[]) => Promise<boolean>
  readonly commit: (options?: GitMutationOptions<GitCommitInput>) => Promise<boolean>
  readonly fetch: (remote?: string) => Promise<boolean>
  readonly pull: (remote?: string, branch?: string) => Promise<boolean>
  readonly push: (options?: GitMutationOptions<GitPushInput>) => Promise<boolean>
  readonly checkoutBranch: (branch: string) => Promise<boolean>
  readonly checkoutRemoteBranch: (remoteBranch: string, localBranch?: string) => Promise<boolean>
  readonly createBranch: (name: string, startPoint?: string) => Promise<boolean>
  readonly deleteBranch: (name: string, force?: boolean) => Promise<boolean>
  readonly addRemote: (name: string, url: string, fetch?: boolean) => Promise<boolean>
  readonly removeRemote: (name: string) => Promise<boolean>
  readonly setUser: (name: string, email: string, scope?: 'local' | 'global') => Promise<boolean>
}

export interface GitReviewControllerOptions {
  readonly autoRefreshOnGitChange?: boolean
}

const GIT_REFRESH_DEBOUNCE_MS = 350

export function useGitReviewController(
  target: GitTargetRef | null,
  options: GitReviewControllerOptions = {}
): GitReviewController {
  const autoRefreshOnGitChange = options.autoRefreshOnGitChange ?? true

  const [intentFile, setIntentFile] = useState<GitReviewSelectedFile | null>(null)
  const [intentCommitHash, setIntentCommitHash] = useState<string | null>(null)
  const [intentCommitFile, setIntentCommitFile] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE)

  const intent = useMemo(
    () => ({
      file: intentFile,
      commitHash: intentCommitHash,
      commitFile: intentCommitFile,
      historyLimit
    }),
    [intentFile, intentCommitHash, intentCommitFile, historyLimit]
  )

  const loadMoreHistory = useCallback(
    () => setHistoryLimit((current) => current + HISTORY_PAGE_SIZE),
    []
  )

  const queries = useGitQueries(target, intent)

  const clearCommitMessage = useCallback(() => setCommitMessage(''), [])
  const mutations = useGitMutations(target, commitMessage, clearCommitMessage)

  useEffect(() => {
    if (!target || !autoRefreshOnGitChange) return undefined
    let refreshTimer: number | null = null
    const unsubscribe = gitClient.onChanged((event) => {
      if (event.cwd !== target.cwd) return
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void mutations.refresh()
      }, GIT_REFRESH_DEBOUNCE_MS)
    })
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [autoRefreshOnGitChange, mutations, target])

  const selectedEntry = useMemo(
    () => selectedEntryFor(queries.selectedFile, queries.status),
    [queries.selectedFile, queries.status]
  )

  const counts = useMemo(
    () => computeCounts(queries.status, queries.overview),
    [queries.status, queries.overview]
  )

  return {
    target,
    overview: queries.overview,
    status: queries.status,
    history: queries.history,
    hasMoreHistory: queries.hasMoreHistory,
    historyLoading: queries.historyLoading,
    loadMoreHistory,
    branches: queries.branches,
    remoteBranches: queries.remoteBranches,
    remotes: queries.remotes,
    worktrees: [],
    user: queries.user,
    selectedFile: queries.selectedFile,
    selectedEntry,
    selectedCommitHash: queries.selectedCommitHash,
    selectedCommitFile: queries.selectedCommitFile,
    commitDetails: queries.commitDetails,
    diff: queries.diff,
    commitDiff: queries.commitDiff,
    commitMessage,
    loading: queries.loading,
    diffLoading: queries.diffLoading,
    commitLoading: queries.commitLoading,
    commitDiffLoading: queries.commitDiffLoading,
    mutating: mutations.mutating,
    pendingAction: mutations.pendingAction,
    isPending: mutations.isPending,
    error: mutations.error ?? queries.error,
    counts,
    setSelectedFile: setIntentFile,
    setSelectedCommitHash: setIntentCommitHash,
    setSelectedCommitFile: setIntentCommitFile,
    setCommitMessage,
    refresh: mutations.refresh,
    initRepository: mutations.initRepository,
    stageFile: mutations.stageFile,
    stageFiles: mutations.stageFiles,
    unstageFile: mutations.unstageFile,
    unstageFiles: mutations.unstageFiles,
    restoreFile: mutations.restoreFile,
    restoreFiles: mutations.restoreFiles,
    discardFile: mutations.discardFile,
    discardFiles: mutations.discardFiles,
    commit: mutations.commit,
    fetch: mutations.fetch,
    pull: mutations.pull,
    push: mutations.push,
    checkoutBranch: mutations.checkoutBranch,
    checkoutRemoteBranch: mutations.checkoutRemoteBranch,
    createBranch: mutations.createBranch,
    deleteBranch: mutations.deleteBranch,
    addRemote: mutations.addRemote,
    removeRemote: mutations.removeRemote,
    setUser: mutations.setUser
  }
}
