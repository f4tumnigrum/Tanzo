import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  FileCode2,
  GitCommitHorizontal,
  RotateCcw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { composeSurfaceClass } from '@/features/chat/ui/compose/surface-style'
import type { GitReviewController } from '../model'
import { DiscardConfirm } from './discard-confirm'
import { FileTreeSection } from './git-file-tree'
import {
  EmptyState,
  GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
  GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME,
  GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME,
  GIT_DIALOG_SPLIT_CLASSNAME,
  GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME,
  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  GIT_DIALOG_TYPO_HEADING_CLASSNAME,
  GIT_DIALOG_TYPO_ITEM_CLASSNAME,
  GIT_DIALOG_TYPO_META_CLASSNAME,
  DeltaStats,
  PatchPreview,
  scopeStats,
  uniqueByPath
} from './git-dialog-shared'

type GitChangeListView = 'changes' | 'staged'

function CommitOptionPill({
  active,
  onToggle,
  children
}: {
  readonly active: boolean
  readonly onToggle: () => void
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        'h-6 rounded-[var(--radius-4xl)] border-0 px-2 text-[0.6875rem] font-medium shadow-none transition-colors',
        active
          ? 'bg-foreground/10 text-foreground hover:bg-foreground/14 hover:text-foreground dark:bg-foreground/15 dark:hover:bg-foreground/20'
          : 'bg-transparent text-muted-foreground/70 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent'
      )}
    >
      {children}
    </Button>
  )
}

function CommitPanel({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [amend, setAmend] = useState(false)
  const [noEdit, setNoEdit] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const stagedCount =
    controller.status?.entries.filter((entry) => entry.staged && !entry.conflicted).length ?? 0
  const canCommit =
    !controller.mutating &&
    (amend || stagedCount > 0) &&
    (noEdit || controller.commitMessage.trim().length > 0)

  return (
    <div className="shrink-0 border-t border-border/15 bg-muted/[0.035] p-3">
      <div
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-[var(--radius-xl)]',
          composeSurfaceClass,
          'backdrop-blur-xl backdrop-saturate-[1.6]',
          'transition-[background-color,border-color,box-shadow] duration-200 ease-out'
        )}
      >
        <div className="scrollbar-none relative max-h-[160px] flex-1 overflow-y-auto">
          <Textarea
            variant="bare"
            value={controller.commitMessage}
            onChange={(event) => controller.setCommitMessage(event.target.value)}
            placeholder={
              noEdit ? t('gitReview.commit.previousMessage') : t('gitReview.commit.message')
            }
            disabled={noEdit}
            rows={1}
            className="min-h-[36px] px-4 py-3 text-sm text-foreground"
          />
        </div>

        <div className="flex flex-wrap items-center gap-0.5 px-3 pb-1">
          <div className="mr-auto flex min-w-0 items-center gap-0.5">
            <CommitOptionPill
              active={amend}
              onToggle={() => {
                setAmend((current) => {
                  const next = !current
                  if (!next) setNoEdit(false)
                  return next
                })
              }}
            >
              {t('gitReview.commit.options.amend')}
            </CommitOptionPill>
            {amend ? (
              <CommitOptionPill active={noEdit} onToggle={() => setNoEdit((current) => !current)}>
                {t('gitReview.commit.options.noEdit')}
              </CommitOptionPill>
            ) : null}
            <CommitOptionPill active={signoff} onToggle={() => setSignoff((current) => !current)}>
              {t('gitReview.commit.options.signoff')}
            </CommitOptionPill>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-0.5">
            <span className="mr-1 truncate text-[0.625rem] text-muted-foreground/65">
              {t('gitReview.counts.staged', { count: stagedCount })}
            </span>
            <div className="ml-0.5 inline-flex items-center gap-0.5 rounded-[var(--radius-4xl)] border border-[var(--compose-control-border)] bg-[var(--compose-control-bg)] p-0.5 shadow-xs backdrop-blur-[var(--compose-surface-blur)]">
              <Button
                type="button"
                size="xs"
                disabled={!canCommit}
                onClick={() => void controller.commit({ amend, noEdit, signoff })}
                className={cn(
                  'h-6 gap-1 rounded-[var(--radius-4xl)] px-2.5 text-[0.6875rem] font-medium',
                  'transition-all duration-150 focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:outline-none',
                  canCommit
                    ? 'bg-foreground text-background shadow-xs hover:bg-foreground/92 active:scale-[0.96] active:bg-foreground/85'
                    : 'pointer-events-none bg-foreground/30 text-background/70 shadow-none'
                )}
              >
                <GitCommitHorizontal
                  className={cn('size-3.5', controller.isPending('commit') && 'animate-pulse')}
                  strokeWidth={1.85}
                />
                {amend ? t('gitReview.actions.amend') : t('gitReview.actions.commit')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ReviewView({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [listView, setListView] = useState<GitChangeListView>('changes')
  const status = controller.status
  const conflicts = status?.entries.filter((entry) => entry.conflicted) ?? []
  const staged = uniqueByPath(
    status?.entries.filter((entry) => entry.staged && !entry.conflicted) ?? []
  )
  const unstaged = uniqueByPath(
    status?.entries.filter((entry) => entry.unstaged && !entry.conflicted) ?? []
  )
  const stageable = unstaged.filter((entry) => !entry.conflicted)
  const stagedPaths = staged.map((entry) => entry.path)
  const stageablePaths = stageable.map((entry) => entry.path)
  // Discard covers every unstaged change (tracked reverts + untracked deletes);
  // the backend routes each path to the right recovery.
  const discardablePaths = stageablePaths
  const untrackedCount = stageable.filter((entry) => entry.untracked).length
  const selectedEntry = controller.selectedFile
    ? (status?.entries.find((entry) => entry.path === controller.selectedFile?.path) ?? null)
    : null
  const selectedStats =
    selectedEntry && controller.selectedFile
      ? scopeStats(selectedEntry, controller.selectedFile.scope)
      : null
  const handleToggleDirectory = (key: string): void => {
    setCollapsedDirectories((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className={GIT_DIALOG_SPLIT_CLASSNAME}>
      <aside className={GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME}>
        <div className={GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
            <GitCommitHorizontal className="size-3.5 shrink-0 text-foreground/45" />
            <span className={cn('truncate', GIT_DIALOG_TYPO_HEADING_CLASSNAME)}>
              {t('gitReview.review.workingTree')}
            </span>
          </div>
          <div className="flex shrink-0 items-center rounded-[min(var(--radius-md),10px)] bg-muted/[0.18] p-0.5">
            <button
              type="button"
              className={cn(
                'flex h-6 items-center gap-1 rounded-[calc(var(--radius-sm)+1px)] px-2 transition-colors',
                GIT_DIALOG_TYPO_ACTION_CLASSNAME,
                listView === 'changes'
                  ? 'bg-background/90 text-foreground shadow-sm'
                  : 'text-foreground/48 hover:text-foreground/72'
              )}
              onClick={() => setListView('changes')}
            >
              {t('gitReview.tabs.changes')}
              <span className={GIT_DIALOG_TYPO_CODE_META_CLASSNAME}>
                {conflicts.length + unstaged.length}
              </span>
            </button>
            <button
              type="button"
              className={cn(
                'flex h-6 items-center gap-1 rounded-[calc(var(--radius-sm)+1px)] px-2 transition-colors',
                GIT_DIALOG_TYPO_ACTION_CLASSNAME,
                listView === 'staged'
                  ? 'bg-background/90 text-foreground shadow-sm'
                  : 'text-foreground/48 hover:text-foreground/72'
              )}
              onClick={() => setListView('staged')}
            >
              {t('gitReview.review.stagedTab')}
              <span className={GIT_DIALOG_TYPO_CODE_META_CLASSNAME}>{staged.length}</span>
            </button>
          </div>
        </div>
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/12 px-2">
          <div className={cn('min-w-0 truncate px-1', GIT_DIALOG_TYPO_META_CLASSNAME)}>
            {listView === 'changes'
              ? t(
                  untrackedCount > 0
                    ? 'gitReview.counts.filesWithUntracked'
                    : 'gitReview.counts.files',
                  {
                    count: conflicts.length + unstaged.length,
                    untracked: untrackedCount
                  }
                )
              : t('gitReview.counts.files', { count: staged.length })}
          </div>
          {listView === 'changes' ? (
            <div className="flex shrink-0 items-center gap-1">
              {discardablePaths.length > 0 ? (
                <DiscardConfirm
                  onConfirm={() => void controller.discardFiles(discardablePaths)}
                  untrackedCount={untrackedCount}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className={cn(
                        GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
                        GIT_DIALOG_TYPO_ACTION_CLASSNAME
                      )}
                      disabled={controller.mutating}
                    >
                      <RotateCcw
                        className={cn('size-3', controller.isPending('discard') && 'animate-pulse')}
                      />
                      {t('gitReview.actions.restore')}
                    </Button>
                  }
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
                disabled={controller.mutating || stageablePaths.length === 0}
                onClick={() => void controller.stageFiles(stageablePaths)}
              >
                <ArrowDownToLine
                  className={cn('size-3', controller.isPending('stage') && 'animate-pulse')}
                />
                {t('gitReview.actions.stageAll')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={controller.mutating || stagedPaths.length === 0}
              onClick={() => void controller.unstageFiles(stagedPaths)}
            >
              <ArrowUpFromLine
                className={cn('size-3', controller.isPending('unstage') && 'animate-pulse')}
              />
              {t('gitReview.actions.unstageAll')}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-subtle">
          <div className="space-y-3">
            {listView === 'changes' ? (
              <>
                <FileTreeSection
                  title={t('gitReview.review.conflicts')}
                  entries={conflicts.map((entry) => ({ entry, scope: 'unstaged' as const }))}
                  collapsedDirectories={collapsedDirectories}
                  onToggleDirectory={handleToggleDirectory}
                  controller={controller}
                />
                <FileTreeSection
                  title={t('gitReview.tabs.changes')}
                  entries={unstaged.map((entry) => ({ entry, scope: 'unstaged' as const }))}
                  collapsedDirectories={collapsedDirectories}
                  onToggleDirectory={handleToggleDirectory}
                  controller={controller}
                />
                {!controller.loading &&
                conflicts.length === 0 &&
                unstaged.length === 0 &&
                staged.length > 0 ? (
                  <div
                    className={cn(
                      'mx-1 flex items-center gap-2 rounded-[min(var(--radius-md),10px)] border border-border/20 bg-muted/[0.15] px-3 py-2',
                      GIT_DIALOG_TYPO_META_CLASSNAME
                    )}
                  >
                    <Check className="size-3.5" />
                    {t('gitReview.states.clean')}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <FileTreeSection
                  title={t('gitReview.review.stagedTab')}
                  entries={staged.map((entry) => ({ entry, scope: 'staged' as const }))}
                  collapsedDirectories={collapsedDirectories}
                  onToggleDirectory={handleToggleDirectory}
                  controller={controller}
                />
                {!controller.loading && staged.length === 0 && status?.entries.length ? (
                  <div
                    className={cn(
                      'mx-1 flex items-center gap-2 rounded-[min(var(--radius-md),10px)] border border-border/20 bg-muted/[0.15] px-3 py-2',
                      GIT_DIALOG_TYPO_META_CLASSNAME
                    )}
                  >
                    <ArrowDownToLine className="size-3.5" />
                    {t('gitReview.states.empty')}
                  </div>
                ) : null}
              </>
            )}
            {!controller.loading && status?.entries.length === 0 ? (
              <div
                className={cn(
                  'mx-1 flex items-center gap-2 rounded-[min(var(--radius-md),10px)] border border-border/20 bg-muted/[0.15] px-3 py-2',
                  GIT_DIALOG_TYPO_META_CLASSNAME
                )}
              >
                <Check className="size-3.5" />
                {t('gitReview.states.clean')}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <div className={GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME}>
          {controller.selectedFile ? (
            <>
              <FileCode2 className="size-3.5 shrink-0 text-foreground/45" />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className={cn('min-w-0 truncate', GIT_DIALOG_TYPO_ITEM_CLASSNAME)}>
                  {controller.selectedFile.path}
                </div>
                <span className="shrink-0 text-foreground/20">·</span>
                <div className={cn('shrink-0', GIT_DIALOG_TYPO_META_CLASSNAME)}>
                  {controller.selectedFile.scope === 'staged'
                    ? t('gitReview.scopes.staged')
                    : t('gitReview.scopes.workingTree')}
                </div>
                {selectedStats ? (
                  <>
                    <span className="shrink-0 text-foreground/20">·</span>
                    <DeltaStats stats={selectedStats} className="shrink-0" />
                  </>
                ) : null}
              </div>
              {controller.selectedFile.scope === 'unstaged' ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
                      GIT_DIALOG_TYPO_ACTION_CLASSNAME
                    )}
                    disabled={controller.mutating || selectedEntry?.conflicted}
                    onClick={() => void controller.stageFile(controller.selectedFile!.path)}
                  >
                    <ArrowDownToLine
                      className={cn('size-3', controller.isPending('stage') && 'animate-pulse')}
                    />
                    {t('gitReview.actions.stage')}
                  </Button>
                  <DiscardConfirm
                    onConfirm={() => void controller.discardFile(controller.selectedFile!.path)}
                    untrackedCount={selectedEntry?.untracked ? 1 : 0}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
                          GIT_DIALOG_TYPO_ACTION_CLASSNAME
                        )}
                        disabled={controller.mutating || selectedEntry?.conflicted}
                      >
                        <RotateCcw className="size-3" />
                        {t('gitReview.actions.restore')}
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
                    GIT_DIALOG_TYPO_ACTION_CLASSNAME
                  )}
                  disabled={controller.mutating}
                  onClick={() => void controller.unstageFile(controller.selectedFile!.path)}
                >
                  <ArrowUpFromLine
                    className={cn('size-3', controller.isPending('unstage') && 'animate-pulse')}
                  />
                  {t('gitReview.actions.unstage')}
                </Button>
              )}
            </>
          ) : (
            <div className={GIT_DIALOG_TYPO_META_CLASSNAME}>{t('gitReview.states.selectFile')}</div>
          )}
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          {!controller.selectedFile ? (
            <EmptyState icon={GitCommitHorizontal} title={t('gitReview.states.selectFile')} />
          ) : (
            <PatchPreview
              diff={controller.diff}
              loading={controller.diffLoading}
              emptyLabel={t('gitReview.diff.noTextual')}
            />
          )}
        </div>
        <CommitPanel controller={controller} />
      </main>
    </div>
  )
}
