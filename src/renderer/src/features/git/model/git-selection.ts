import type {
  GitCommitDetails,
  GitHistoryPage,
  GitOverview,
  GitStatusEntry,
  GitStatusSnapshot
} from '@shared/git'

export type GitFileScope = 'staged' | 'unstaged'

export interface GitReviewSelectedFile {
  readonly path: string
  readonly scope: GitFileScope
}

export interface GitReviewCounts {
  readonly staged: number
  readonly unstaged: number
  readonly untracked: number
  readonly conflicts: number
}

export function entryHasScope(entry: GitStatusEntry, scope: GitFileScope): boolean {
  return scope === 'staged' ? Boolean(entry.staged) : Boolean(entry.unstaged)
}

export function firstSelectableEntry(
  status: GitStatusSnapshot | null
): GitReviewSelectedFile | null {
  const conflict = status?.entries.find((entry) => entry.conflicted)
  if (conflict) return { path: conflict.path, scope: 'unstaged' }
  const unstaged = status?.entries.find((entry) => entry.unstaged)
  if (unstaged) return { path: unstaged.path, scope: 'unstaged' }
  const staged = status?.entries.find((entry) => entry.staged)
  if (staged) return { path: staged.path, scope: 'staged' }
  return null
}

export function resolveSelectedFile(
  intent: GitReviewSelectedFile | null,
  status: GitStatusSnapshot | null
): GitReviewSelectedFile | null {
  if (
    intent &&
    status?.entries.some(
      (entry) => entry.path === intent.path && entryHasScope(entry, intent.scope)
    )
  ) {
    return intent
  }
  return firstSelectableEntry(status)
}

export function resolveCommitHash(
  intent: string | null,
  history: GitHistoryPage | null
): string | null {
  if (intent && history?.entries.some((entry) => entry.hash === intent)) return intent
  return history?.entries[0]?.hash ?? null
}

export function resolveCommitFile(
  intent: string | null,
  details: GitCommitDetails | null
): string | null {
  if (intent && details?.files.some((file) => file.path === intent)) return intent
  return details?.files[0]?.path ?? null
}

export function selectedEntryFor(
  selectedFile: GitReviewSelectedFile | null,
  status: GitStatusSnapshot | null
): GitStatusEntry | null {
  if (!selectedFile) return null
  return status?.entries.find((entry) => entry.path === selectedFile.path) ?? null
}

export function computeCounts(
  status: GitStatusSnapshot | null,
  overview: GitOverview | null
): GitReviewCounts {
  return {
    staged: status?.entries.filter((entry) => entry.staged).length ?? overview?.stagedCount ?? 0,
    unstaged:
      status?.entries.filter((entry) => entry.unstaged && !entry.untracked).length ??
      overview?.unstagedCount ??
      0,
    untracked:
      status?.entries.filter((entry) => entry.untracked).length ?? overview?.untrackedCount ?? 0,
    conflicts:
      status?.entries.filter((entry) => entry.conflicted).length ?? overview?.conflictCount ?? 0
  }
}
