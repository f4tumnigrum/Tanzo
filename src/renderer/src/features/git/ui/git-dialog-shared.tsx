/* eslint-disable react-refresh/only-export-components -- Shared Git dialog constants and small helper components are intentionally colocated for consistent styling. */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitDiffResult, GitStatusEntry } from '@shared/git'
import { DiffBlock } from './diff-block'
import type { GitReviewController } from '../model'

export const GIT_DIALOG_HEADER_BAR_CLASSNAME =
  'flex shrink-0 items-center gap-2 overflow-hidden border-b border-border/36 bg-muted/55 px-2.5 py-1.5 sm:px-3'
export const GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME =
  'flex h-11 items-center border-b border-border/15 px-2'
export const GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME =
  'flex h-11 items-center gap-2 border-b border-border/12 bg-muted/[0.04] px-3'
export const GIT_DIALOG_TAB_LIST_CLASSNAME =
  'h-7 min-w-0 max-w-full overflow-x-auto rounded-[min(var(--radius-md),10px)] border border-border/24 bg-background/68 p-[2px] shadow-none backdrop-blur-sm scrollbar-none'
export const GIT_DIALOG_TAB_TRIGGER_CLASSNAME =
  'h-6 shrink-0 gap-1.5 rounded-[calc(var(--radius-sm)+1px)] border border-transparent px-2.5 text-foreground/52 shadow-none hover:border-border/12 hover:bg-background/50 hover:text-foreground/78 data-active:border-border/22 data-active:bg-background/94 data-active:text-foreground'
export const GIT_DIALOG_SPLIT_CLASSNAME =
  'grid h-full min-h-0 grid-rows-[minmax(180px,38%)_minmax(0,1fr)] md:grid-cols-[clamp(240px,28vw,320px)_minmax(0,1fr)] md:grid-rows-none'
export const GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME =
  'flex min-h-0 min-w-0 flex-col border-b border-border/15 md:border-r md:border-b-0'
export const GIT_DIALOG_TYPO_HEADING_CLASSNAME =
  'text-[0.8125rem] font-medium tracking-[-0.005em] text-foreground/84'
export const GIT_DIALOG_TYPO_BODY_CLASSNAME = 'text-[0.8125rem] leading-[1.72] text-foreground/90'
export const GIT_DIALOG_TYPO_META_CLASSNAME =
  'text-[0.6875rem] leading-[1.6] tracking-[0.01em] text-foreground/52'
export const GIT_DIALOG_TYPO_ITEM_CLASSNAME =
  'text-[0.75rem] font-medium tracking-[0.01em] text-foreground/82'
export const GIT_DIALOG_TYPO_LABEL_CLASSNAME =
  'text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-foreground/60'
export const GIT_DIALOG_TYPO_CODE_CLASSNAME =
  'font-mono text-[length:var(--code-font-size-lg)] leading-[1.55] text-foreground/82'
export const GIT_DIALOG_TYPO_CODE_META_CLASSNAME =
  'font-mono text-[length:var(--code-font-size)] leading-[1.5] text-foreground/45'
export const GIT_DIALOG_TYPO_ACTION_CLASSNAME = 'text-[0.6875rem] font-medium tracking-[0.01em]'
export const GIT_DIALOG_HEADER_PILL_CLASSNAME =
  'inline-flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] border border-border/24 bg-background/68 px-2.5 text-foreground/64 shadow-none backdrop-blur-sm'
export const GIT_DIALOG_HEADER_ICON_BUTTON_CLASSNAME =
  'h-7 w-7 rounded-[min(var(--radius-md),10px)] border border-border/24 bg-background/68 p-0 text-foreground/50 shadow-none backdrop-blur-sm hover:border-border/32 hover:bg-background/86 hover:text-foreground'
export const GIT_DIALOG_INPUT_CLASSNAME =
  'h-8 rounded-[min(var(--radius-md),10px)] border-border/28 bg-muted/[0.14] shadow-none placeholder:text-foreground/35 focus-visible:border-border/45 focus-visible:ring-0 focus-visible:ring-offset-0'
export const GIT_DIALOG_TEXTAREA_CLASSNAME =
  'resize-none rounded-[min(var(--radius-md),10px)] border-border/28 bg-muted/[0.14] shadow-none placeholder:text-foreground/35 focus-visible:border-border/45 focus-visible:ring-0 focus-visible:ring-offset-0'
export const GIT_DIALOG_BUTTON_CLASSNAME =
  'h-7 rounded-[min(var(--radius-md),10px)] px-3 shadow-none'
export const GIT_DIALOG_GHOST_BUTTON_CLASSNAME =
  'h-6 rounded-[var(--radius-sm)] px-2 shadow-none text-foreground/56 hover:bg-muted/42 hover:text-foreground'
export const GIT_DIALOG_ICON_BUTTON_CLASSNAME =
  'h-6 w-6 rounded-[var(--radius-sm)] p-0 shadow-none text-foreground/46 hover:bg-muted/42 hover:text-foreground'

export const TAB_TRIGGER_CLASSNAME = cn(
  GIT_DIALOG_TAB_TRIGGER_CLASSNAME,
  GIT_DIALOG_TYPO_ACTION_CLASSNAME
)
export const FIELD_CLASSNAME = cn(
  GIT_DIALOG_INPUT_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  'text-foreground/85'
)
export const TEXTAREA_CLASSNAME = cn(
  GIT_DIALOG_TEXTAREA_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  'text-foreground/85'
)
export const SIDEBAR_ROW_CLASSNAME =
  'group/row flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-[background-color,color,box-shadow,opacity] duration-150 ease-out hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]'

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return DATE_FORMATTER.format(date)
}

export function shortSha(value: string | null | undefined, fallback: string): string {
  return value ? value.slice(0, 7) : fallback
}

export function formatGitUserLabel(user: GitReviewController['user']): string | null {
  const name = user?.name?.trim()
  const email = user?.email?.trim()
  return name || email || null
}

export interface GitDeltaStats {
  readonly additions: number
  readonly deletions: number
  readonly binary?: boolean
}

export function uniqueByPath(entries: readonly GitStatusEntry[]): GitStatusEntry[] {
  const seen = new Set<string>()
  const unique: GitStatusEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    unique.push(entry)
  }
  return unique
}

export function scopeStats(
  entry: GitStatusEntry,
  scope: 'staged' | 'unstaged'
): GitDeltaStats | null {
  const stats = scope === 'staged' ? entry.staged : entry.unstaged
  if (!stats) return null
  if (stats.binary) return { additions: 0, deletions: 0, binary: true }
  if (stats.additions === 0 && stats.deletions === 0) return null
  return { additions: stats.additions, deletions: stats.deletions }
}

export function DeltaStats({
  stats,
  className
}: {
  readonly stats: GitDeltaStats
  readonly className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  if (stats.binary) {
    return (
      <span className={cn(GIT_DIALOG_TYPO_CODE_META_CLASSNAME, className)}>
        {t('gitReview.diff.binary')}
      </span>
    )
  }
  return (
    <span
      className={cn(
        GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
        'inline-flex items-center gap-1',
        className
      )}
    >
      {stats.additions > 0 ? <span className="text-emerald-500/80">+{stats.additions}</span> : null}
      {stats.deletions > 0 ? <span className="text-red-500/80">-{stats.deletions}</span> : null}
    </span>
  )
}

export function RefDelta({
  ahead,
  behind,
  className
}: {
  readonly ahead: number
  readonly behind: number
  readonly className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
        'inline-flex items-center gap-1 tabular-nums',
        className
      )}
    >
      {ahead > 0 ? <span className="text-emerald-500/80">↑{ahead}</span> : null}
      {behind > 0 ? <span className="text-red-500/80">↓{behind}</span> : null}
      {ahead === 0 && behind === 0 ? <span className="text-foreground/30">·</span> : null}
    </span>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  detail,
  action
}: {
  readonly icon: LucideIcon
  readonly title: string
  readonly detail?: string
  readonly action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <Icon className="size-5 text-foreground/25" />
        <div className={GIT_DIALOG_TYPO_HEADING_CLASSNAME}>{title}</div>
        {detail ? (
          <p className={cn(GIT_DIALOG_TYPO_BODY_CLASSNAME, 'text-foreground/52')}>{detail}</p>
        ) : null}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </div>
  )
}

export function CheckOption({
  checked,
  onChange,
  children
}: {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly children: ReactNode
}): React.JSX.Element {
  return (
    <label className={cn('inline-flex items-center gap-1.5', GIT_DIALOG_TYPO_META_CLASSNAME)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3 rounded border-border accent-primary"
      />
      <span>{children}</span>
    </label>
  )
}

export function PatchPreview({
  diff,
  loading,
  emptyLabel
}: {
  readonly diff: GitDiffResult | null
  readonly loading: boolean
  readonly emptyLabel: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const patch = diff?.patch.trimEnd() ?? ''
  if (loading) {
    return (
      <div
        className={cn(
          GIT_DIALOG_TYPO_BODY_CLASSNAME,
          'flex h-full items-center justify-center text-foreground/52'
        )}
      >
        {t('gitReview.diff.loading')}
      </div>
    )
  }
  if (diff?.binary) {
    return (
      <div
        className={cn(
          GIT_DIALOG_TYPO_BODY_CLASSNAME,
          'flex h-full items-center justify-center text-foreground/52'
        )}
      >
        {t('gitReview.diff.binaryUnavailable')}
      </div>
    )
  }
  if (!patch) {
    return (
      <div
        className={cn(
          GIT_DIALOG_TYPO_META_CLASSNAME,
          'flex h-full items-center justify-center text-foreground/40'
        )}
      >
        {emptyLabel}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-none">
      <DiffBlock
        diff={patch}
        maxHeight="100%"
        wrapLongLines
        className="min-h-0 flex-1 rounded-none"
      />
      {diff?.truncated ? (
        <div
          className={cn(
            GIT_DIALOG_TYPO_META_CLASSNAME,
            'shrink-0 border-t border-border/10 bg-muted/[0.06] px-3 py-1 text-foreground/45'
          )}
        >
          {t('gitReview.diff.truncated')}
        </div>
      ) : null}
    </div>
  )
}
