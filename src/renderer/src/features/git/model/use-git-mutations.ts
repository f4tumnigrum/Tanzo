import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { gitClient } from '@/platform/electron/git-client'
import type { GitCommitInput, GitPushInput, GitSyncResult, GitTargetRef } from '@shared/git'
import { gitKeys } from './git-query-keys'

type GitMutationOptions<T> = Omit<T, 'cwd'>

export type GitActionKind =
  | 'init'
  | 'stage'
  | 'unstage'
  | 'restore'
  | 'discard'
  | 'commit'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'checkout'
  | 'createBranch'
  | 'deleteBranch'
  | 'addRemote'
  | 'removeRemote'
  | 'setUser'

export interface GitMutations {
  readonly pendingAction: GitActionKind | null
  readonly mutating: boolean
  readonly isPending: (action: GitActionKind) => boolean
  readonly error: string | null
  readonly clearError: () => void
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

function summarizeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function syncMessage(result: GitSyncResult): string {
  const t = i18n.t
  if (result.hasConflicts) return t('gitReview.sync.result.conflicts')
  if (result.noop) {
    return result.kind === 'fetch'
      ? t('gitReview.sync.result.fetchedNothing')
      : t('gitReview.sync.result.upToDate')
  }
  if (result.kind === 'push') {
    return t('gitReview.sync.result.pushed', { count: result.published })
  }
  if (result.kind === 'fetch') return t('gitReview.sync.result.fetched')
  return t('gitReview.sync.result.pulled', { count: result.received })
}

export function useGitMutations(
  target: GitTargetRef | null,
  commitMessage: string,
  onCommitted: () => void
): GitMutations {
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<GitActionKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cwd = target?.cwd ?? ''

  const refresh = useCallback(async () => {
    if (!cwd) return
    await queryClient.invalidateQueries({ queryKey: gitKeys.repo(cwd) })
  }, [cwd, queryClient])

  const runMutation = useCallback(
    async (
      action: GitActionKind,
      run: () => Promise<unknown>,
      fallback: string
    ): Promise<boolean> => {
      if (!target) return false
      setPendingAction(action)
      try {
        await run()
        await queryClient.invalidateQueries({ queryKey: gitKeys.repo(target.cwd) })
        setError(null)
        return true
      } catch (mutationError) {
        const message = summarizeError(mutationError, fallback)
        setError(message)
        toast.error(message)
        return false
      } finally {
        setPendingAction(null)
      }
    },
    [queryClient, target]
  )

  const initRepository = useCallback(
    (initialBranch?: string) =>
      runMutation(
        'init',
        () =>
          gitClient.init({ ...(target as GitTargetRef), initialBranch: optional(initialBranch) }),
        i18n.t('gitReview.errors.initializeRepository')
      ),
    [runMutation, target]
  )

  const stageFile = useCallback(
    (path: string) =>
      runMutation(
        'stage',
        () => gitClient.stage({ ...(target as GitTargetRef), paths: [path] }),
        i18n.t('gitReview.errors.stageFile')
      ),
    [runMutation, target]
  )

  const stageFiles = useCallback(
    (paths: readonly string[]) =>
      paths.length === 0
        ? Promise.resolve(false)
        : runMutation(
            'stage',
            () => gitClient.stage({ ...(target as GitTargetRef), paths }),
            i18n.t('gitReview.errors.stageFiles')
          ),
    [runMutation, target]
  )

  const unstageFile = useCallback(
    (path: string) =>
      runMutation(
        'unstage',
        () => gitClient.restoreStaged({ ...(target as GitTargetRef), paths: [path] }),
        i18n.t('gitReview.errors.unstageFile')
      ),
    [runMutation, target]
  )

  const unstageFiles = useCallback(
    (paths: readonly string[]) =>
      paths.length === 0
        ? Promise.resolve(false)
        : runMutation(
            'unstage',
            () => gitClient.restoreStaged({ ...(target as GitTargetRef), paths }),
            i18n.t('gitReview.errors.unstageFiles')
          ),
    [runMutation, target]
  )

  const restoreFile = useCallback(
    (path: string) =>
      runMutation(
        'restore',
        () => gitClient.restoreWorktree({ ...(target as GitTargetRef), paths: [path] }),
        i18n.t('gitReview.errors.restoreFile')
      ),
    [runMutation, target]
  )

  const restoreFiles = useCallback(
    (paths: readonly string[]) =>
      paths.length === 0
        ? Promise.resolve(false)
        : runMutation(
            'restore',
            () => gitClient.restoreWorktree({ ...(target as GitTargetRef), paths }),
            i18n.t('gitReview.errors.restoreFiles')
          ),
    [runMutation, target]
  )

  const discardFile = useCallback(
    (path: string) =>
      runMutation(
        'discard',
        () => gitClient.discard({ ...(target as GitTargetRef), paths: [path] }),
        i18n.t('gitReview.errors.discardFile')
      ),
    [runMutation, target]
  )

  const discardFiles = useCallback(
    (paths: readonly string[]) =>
      paths.length === 0
        ? Promise.resolve(false)
        : runMutation(
            'discard',
            () => gitClient.discard({ ...(target as GitTargetRef), paths }),
            i18n.t('gitReview.errors.discardFiles')
          ),
    [runMutation, target]
  )

  const commit = useCallback(
    (commitOptions: GitMutationOptions<GitCommitInput> = {}) => {
      if (!target) return Promise.resolve(false)
      const message = optional(commitOptions.message) ?? commitMessage.trim()
      if (!commitOptions.noEdit && !message) {
        toast.error(i18n.t('gitReview.errors.commitMessageRequired'))
        return Promise.resolve(false)
      }
      return runMutation(
        'commit',
        async () => {
          await gitClient.commit({ ...target, ...commitOptions, message })
          onCommitted()
        },
        i18n.t('gitReview.errors.createCommit')
      )
    },
    [commitMessage, onCommitted, runMutation, target]
  )

  const runSync = useCallback(
    (
      action: Extract<GitActionKind, 'fetch' | 'pull' | 'push'>,
      run: () => Promise<GitSyncResult>,
      fallback: string
    ) =>
      runMutation(
        action,
        async () => {
          const result = await run()
          if (result.hasConflicts) toast.warning(syncMessage(result))
          else toast.success(syncMessage(result))
        },
        fallback
      ),
    [runMutation]
  )

  const fetch = useCallback(
    (remote?: string) =>
      runSync(
        'fetch',
        () => gitClient.fetch({ ...(target as GitTargetRef), remote: optional(remote) }),
        i18n.t('gitReview.errors.fetch')
      ),
    [runSync, target]
  )

  const pull = useCallback(
    (remote?: string, branch?: string) =>
      runSync(
        'pull',
        () =>
          gitClient.pull({
            ...(target as GitTargetRef),
            remote: optional(remote),
            branch: optional(branch)
          }),
        i18n.t('gitReview.errors.pull')
      ),
    [runSync, target]
  )

  const push = useCallback(
    (pushOptions: GitMutationOptions<GitPushInput> = {}) =>
      runSync(
        'push',
        () =>
          gitClient.push({
            ...(target as GitTargetRef),
            ...pushOptions,
            remote: optional(pushOptions.remote),
            branch: optional(pushOptions.branch),
            lease: optional(pushOptions.lease)
          }),
        i18n.t('gitReview.errors.push')
      ),
    [runSync, target]
  )

  const checkoutBranch = useCallback(
    (branch: string) =>
      runMutation(
        'checkout',
        () => gitClient.checkout({ ...(target as GitTargetRef), ref: branch }),
        i18n.t('gitReview.errors.checkoutBranch')
      ),
    [runMutation, target]
  )

  const checkoutRemoteBranch = useCallback(
    (remoteBranch: string, localBranch?: string) =>
      runMutation(
        'checkout',
        () =>
          gitClient.checkoutRemoteBranch({
            ...(target as GitTargetRef),
            remoteBranch,
            localBranch: optional(localBranch)
          }),
        i18n.t('gitReview.errors.checkoutRemoteBranch')
      ),
    [runMutation, target]
  )

  const createBranch = useCallback(
    (name: string, startPoint?: string) => {
      const branchName = name.trim()
      if (!branchName) {
        toast.error(i18n.t('gitReview.errors.branchNameRequired'))
        return Promise.resolve(false)
      }
      return runMutation(
        'createBranch',
        () =>
          gitClient.createBranch({
            ...(target as GitTargetRef),
            name: branchName,
            startPoint: optional(startPoint)
          }),
        i18n.t('gitReview.errors.createBranch')
      )
    },
    [runMutation, target]
  )

  const deleteBranch = useCallback(
    (name: string, force?: boolean) =>
      runMutation(
        'deleteBranch',
        () => gitClient.deleteBranch({ ...(target as GitTargetRef), name, force }),
        i18n.t('gitReview.errors.deleteBranch')
      ),
    [runMutation, target]
  )

  const addRemote = useCallback(
    (name: string, url: string, fetchRemote?: boolean) =>
      runMutation(
        'addRemote',
        () =>
          gitClient.addRemote({
            ...(target as GitTargetRef),
            name: name.trim(),
            url: url.trim(),
            fetch: fetchRemote
          }),
        i18n.t('gitReview.errors.addRemote')
      ),
    [runMutation, target]
  )

  const removeRemote = useCallback(
    (name: string) =>
      runMutation(
        'removeRemote',
        () => gitClient.removeRemote({ ...(target as GitTargetRef), name }),
        i18n.t('gitReview.errors.removeRemote')
      ),
    [runMutation, target]
  )

  const setUser = useCallback(
    (name: string, email: string, scope?: 'local' | 'global') =>
      runMutation(
        'setUser',
        () =>
          gitClient.setUser({
            ...(target as GitTargetRef),
            name: name.trim(),
            email: email.trim(),
            scope
          }),
        i18n.t('gitReview.errors.saveIdentity')
      ),
    [runMutation, target]
  )

  const clearError = useCallback(() => setError(null), [])
  const isPending = useCallback(
    (action: GitActionKind) => pendingAction === action,
    [pendingAction]
  )

  return {
    pendingAction,
    mutating: pendingAction !== null,
    isPending,
    error,
    clearError,
    refresh,
    initRepository,
    stageFile,
    stageFiles,
    unstageFile,
    unstageFiles,
    restoreFile,
    restoreFiles,
    discardFile,
    discardFiles,
    commit,
    fetch,
    pull,
    push,
    checkoutBranch,
    checkoutRemoteBranch,
    createBranch,
    deleteBranch,
    addRemote,
    removeRemote,
    setUser
  }
}
