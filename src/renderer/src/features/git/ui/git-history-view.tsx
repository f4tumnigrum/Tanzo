import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, Clock3, FileCode2, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { GitCommitFileChange, GitLogEntry } from '@shared/git'
import type { GitReviewController } from '../model'
import {
  DeltaStats,
  EmptyState,
  GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME,
  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
  GIT_DIALOG_SPLIT_CLASSNAME,
  GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  GIT_DIALOG_TYPO_ITEM_CLASSNAME,
  GIT_DIALOG_TYPO_META_CLASSNAME,
  PatchPreview,
  formatDate
} from './git-dialog-shared'

function CommitFileRow({
  file,
  selected,
  onSelect
}: {
  readonly file: GitCommitFileChange
  readonly selected: boolean
  readonly onSelect: () => void
}): React.JSX.Element {
  const name = file.path.split(/[/\\]/).pop() ?? file.path
  const dir = file.path.slice(0, file.path.length - name.length)
  const stats =
    file.binary || (file.additions === 0 && file.deletions === 0)
      ? file.binary
        ? { additions: 0, deletions: 0, binary: true }
        : null
      : { additions: file.additions, deletions: file.deletions }
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group/file flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-left transition-[background-color,color] duration-150 ease-out',
        selected
          ? 'bg-[color-mix(in_oklab,var(--sidebar-primary)_12%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--sidebar-primary)_20%,transparent)] dark:bg-[color-mix(in_oklab,var(--sidebar-primary)_15%,transparent)] dark:ring-[color-mix(in_oklab,var(--sidebar-primary)_24%,transparent)]'
          : 'hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]'
      )}
    >
      <FileCode2
        className={cn('size-3.5 shrink-0', selected ? 'text-foreground/70' : 'text-foreground/38')}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[0.8125rem] leading-tight',
          selected ? 'font-medium text-foreground' : 'text-foreground/78'
        )}
      >
        {dir ? <span className="text-foreground/35">{dir}</span> : null}
        {name}
      </span>
      {stats ? <DeltaStats stats={stats} className="shrink-0" /> : null}
    </button>
  )
}

function CommitPickerRow({
  entry,
  selected,
  onSelect
}: {
  readonly entry: GitLogEntry
  readonly selected: boolean
  readonly onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors duration-150',
        selected
          ? 'bg-[color-mix(in_oklab,var(--sidebar-primary)_14%,transparent)] text-foreground'
          : 'text-foreground/78 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]'
      )}
    >
      <span
        className={cn(
          'w-12 shrink-0 tabular-nums',
          GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
          selected && 'text-foreground/70'
        )}
      >
        {entry.shortHash}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.75rem]">
        {entry.subject || t('gitReview.history.noSubject')}
      </span>
      <span className={cn('shrink-0 text-[0.625rem]', GIT_DIALOG_TYPO_META_CLASSNAME)}>
        {formatDate(entry.date)}
      </span>
    </button>
  )
}

export function HistoryView({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const entries = controller.history?.entries ?? []
  const selectedEntry =
    entries.find((entry) => entry.hash === controller.selectedCommitHash) ?? null
  const files = controller.commitDetails?.files ?? []

  return (
    <div className={GIT_DIALOG_SPLIT_CLASSNAME}>
      <aside className={GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME}>
        <div className={cn(GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME, 'gap-1.5')}>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={t('gitReview.history.pickCommit')}
                  className="h-8 min-w-0 flex-1 justify-start gap-1.5 rounded-[min(var(--radius-md),10px)] border-border/40 bg-muted/[0.14] px-2 shadow-none hover:bg-muted/[0.28] aria-expanded:bg-muted/[0.3]"
                >
                  <History className="size-3.5 shrink-0 text-foreground/45" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-left',
                      GIT_DIALOG_TYPO_ITEM_CLASSNAME
                    )}
                  >
                    {selectedEntry?.subject || t('gitReview.states.selectCommit')}
                  </span>
                  {selectedEntry ? (
                    <span className={cn('shrink-0', GIT_DIALOG_TYPO_CODE_META_CLASSNAME)}>
                      {selectedEntry.shortHash}
                    </span>
                  ) : null}
                  <ChevronsUpDown className="size-3.5 shrink-0 text-foreground/55" />
                </Button>
              }
            />
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={6}
              className="w-[300px] rounded-[min(var(--radius-lg),14px)] border border-border/35 bg-background/96 p-1 shadow-lg backdrop-blur-md"
            >
              <div className="max-h-[min(60vh,360px)] min-h-0 space-y-px overflow-y-auto scrollbar-subtle">
                {entries.map((entry) => (
                  <CommitPickerRow
                    key={entry.hash}
                    entry={entry}
                    selected={controller.selectedCommitHash === entry.hash}
                    onSelect={() => {
                      controller.setSelectedCommitHash(entry.hash)
                      setPickerOpen(false)
                    }}
                  />
                ))}
                {controller.hasMoreHistory ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={controller.historyLoading}
                    onClick={() => controller.loadMoreHistory()}
                    className={cn(
                      'mt-0.5 h-7 w-full justify-center rounded-[var(--radius-sm)]',
                      GIT_DIALOG_TYPO_ACTION_CLASSNAME,
                      'text-foreground/55 hover:text-foreground'
                    )}
                  >
                    {controller.historyLoading
                      ? t('common.actions.refreshing')
                      : t('gitReview.history.loadMore')}
                  </Button>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/12 px-3">
          {selectedEntry ? (
            <>
              <div
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2',
                  GIT_DIALOG_TYPO_META_CLASSNAME
                )}
              >
                <span className="min-w-0 truncate">{selectedEntry.author}</span>
                <Clock3 className="size-3 shrink-0 text-foreground/35" />
                <span className="shrink-0">{formatDate(selectedEntry.date)}</span>
              </div>
              <span className={cn('shrink-0', GIT_DIALOG_TYPO_CODE_META_CLASSNAME)}>
                {t('gitReview.counts.files', { count: files.length })}
              </span>
            </>
          ) : (
            <span className={GIT_DIALOG_TYPO_META_CLASSNAME}>
              {t('gitReview.states.selectCommit')}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-px overflow-y-auto p-2 scrollbar-subtle">
          {selectedEntry ? (
            files.length > 0 ? (
              files.map((file) => (
                <CommitFileRow
                  key={file.path}
                  file={file}
                  selected={controller.selectedCommitFile === file.path}
                  onSelect={() => controller.setSelectedCommitFile(file.path)}
                />
              ))
            ) : (
              <div className={cn('px-2 py-4 text-center', GIT_DIALOG_TYPO_META_CLASSNAME)}>
                {t('gitReview.diff.noTextual')}
              </div>
            )
          ) : null}
        </div>
      </aside>
      <main className="flex min-h-0 flex-col overflow-hidden">
        {!controller.selectedCommitHash ? (
          <EmptyState icon={History} title={t('gitReview.states.selectCommit')} />
        ) : controller.selectedCommitFile ? (
          <PatchPreview
            diff={controller.commitDiff}
            loading={controller.commitDiffLoading || controller.commitLoading}
            emptyLabel={t('gitReview.diff.noTextual')}
          />
        ) : (
          <EmptyState icon={History} title={t('gitReview.states.selectFile')} />
        )}
      </main>
    </div>
  )
}
