import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileDiff, RotateCcw, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { ChangeEntry, ChangePreviewData } from '@shared/change-set'
import { changeSetClient } from '@/platform/electron/change-set-client'
import { DiffBlock } from './diff-block'

interface ChangePreviewProps {
  readonly preview: ChangePreviewData
  readonly onApplied?: (next: ChangePreviewData) => void
  readonly className?: string
}

function splitName(path: string): { fileName: string; directory: string | null } {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const fileName = segments[segments.length - 1] ?? path
  const directory = segments.length > 1 ? segments.slice(0, -1).join('/') : null
  return { fileName, directory }
}

function statusClass(status: string): string {
  switch (status) {
    case 'materialized':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'skipped':
      return 'border-muted-foreground/20 bg-muted/40 text-muted-foreground'
    case 'partial':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'failed':
      return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
    default:
      return 'border-border/30 bg-muted/40 text-muted-foreground'
  }
}

const PAGE_SIZE = 7

function collectRestorePaths(files: readonly ChangeEntry[]): string[] {
  return [
    ...new Set(
      files.flatMap((file) =>
        [file.path, file.oldPath].filter((value): value is string => Boolean(value))
      )
    )
  ]
}

export function ChangePreview({
  preview,
  onApplied,
  className
}: ChangePreviewProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [patches, setPatches] = useState<Record<string, string>>({})
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<'before' | 'after' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'before' | 'after' | null>(null)
  const [rawPage, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(preview.files.length / PAGE_SIZE))
  const page = Math.min(rawPage, pageCount - 1)

  const pageFiles = useMemo(
    () => preview.files.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [preview.files, page]
  )

  const restorePaths = useMemo(() => collectRestorePaths(preview.files), [preview.files])
  const risk = preview.restoreRisk
  const status = preview.materialization.status

  const loadPatch = useCallback(
    async (file: ChangeEntry) => {
      if (file.binary || !file.patchAvailable) return
      if (Object.prototype.hasOwnProperty.call(patches, file.path)) return
      setLoadingPath(file.path)
      try {
        const diff = await changeSetClient.getChangeSetFilePatch(preview.changeSetId, file.path)
        setPatches((current) => ({ ...current, [file.path]: diff ?? '' }))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingPath((current) => (current === file.path ? null : current))
      }
    },
    [patches, preview.changeSetId]
  )

  const toggleFile = useCallback(
    (file: ChangeEntry) => {
      const next = expandedFile === file.path ? null : file.path
      setExpandedFile(next)
      if (next) void loadPatch(file)
    },
    [expandedFile, loadPatch]
  )

  const runApply = useCallback(
    async (targetState: 'before' | 'after', force: boolean) => {
      setRestoring(targetState)
      setError(null)
      try {
        const result = await changeSetClient.applyChangeSet({
          changeSetId: preview.changeSetId,
          targetState,
          paths: restorePaths,
          force
        })
        onApplied?.(result.changeSet)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRestoring(null)
      }
    },
    [onApplied, preview.changeSetId, restorePaths]
  )

  const handleApply = useCallback(
    (targetState: 'before' | 'after') => {
      if (risk.code === 'blocked') return
      if (risk.code === 'high' || risk.code === 'medium' || risk.code === 'low') {
        setConfirm(targetState)
        return
      }
      void runApply(targetState, false)
    },
    [risk.code, runApply]
  )

  const disableBefore =
    restoring !== null || status === 'skipped' || status === 'unknown' || status === 'failed'
  const disableAfter =
    restoring !== null || status === 'materialized' || status === 'unknown' || status === 'failed'

  if (preview.files.length === 0) return null

  return (
    <div
      className={cn(
        '@container/change mt-2 overflow-hidden rounded-[var(--radius-lg)] border border-border/40 bg-secondary/60',
        className
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-foreground">
          <FileDiff className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {t('gitReview.changePreview.files', { count: preview.fileCount })}
          </span>
          <span className="shrink-0 font-mono text-emerald-600">+{preview.additions}</span>
          <span className="shrink-0 font-mono text-red-600">-{preview.deletions}</span>
          <span
            className={cn(
              'shrink-0 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide',
              statusClass(status)
            )}
          >
            {t(`gitReview.changePreview.status.${status}`)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => handleApply('before')}
            disabled={disableBefore}
            className="gap-1 text-[0.6875rem]"
          >
            <RotateCcw className="size-3" />
            {restoring === 'before'
              ? t('common.actions.refreshing')
              : t('gitReview.changePreview.restoreBefore')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => handleApply('after')}
            disabled={disableAfter}
            className="gap-1 text-[0.6875rem]"
          >
            <RotateCw className="size-3" />
            {restoring === 'after'
              ? t('common.actions.refreshing')
              : t('gitReview.changePreview.restoreAfter')}
          </Button>
        </div>
      </div>

      {error || (risk.message && risk.code !== 'none') ? (
        <div
          className={cn(
            'border-b px-3 py-2 text-xs',
            error
              ? 'border-red-500/30 bg-red-500/10 text-destructive'
              : risk.code === 'medium'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-red-500/30 bg-red-500/10 text-destructive'
          )}
        >
          {error ?? risk.message}
        </div>
      ) : null}

      <div className="divide-y divide-border/30">
        {pageFiles.map((file) => {
          const open = expandedFile === file.path
          const { fileName, directory } = splitName(file.path)
          const patch = patches[file.path]
          return (
            <div key={file.path}>
              <button
                type="button"
                onClick={() => toggleFile(file)}
                className="group flex w-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap px-3 py-2 text-left text-xs hover:bg-foreground/[0.03]"
              >
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-90'
                  )}
                />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-foreground"
                  title={file.path}
                >
                  {directory ? <span className="text-foreground/55">{directory}/</span> : null}
                  {fileName}
                </span>
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                  <span className="shrink-0 rounded-[var(--radius-sm)] border border-border/35 px-1 py-0.5 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                    {t(`gitReview.changePreview.kind.${file.kind}`)}
                  </span>
                  <span className="font-mono text-emerald-600">+{file.additions}</span>
                  <span className="font-mono text-red-600">-{file.deletions}</span>
                </span>
              </button>
              {open ? (
                <div>
                  {loadingPath === file.path ? (
                    <div className="px-3 pb-3 text-xs text-muted-foreground">
                      {t('gitReview.changePreview.loadingPatch')}
                    </div>
                  ) : file.binary ? (
                    <div className="px-3 pb-3 text-xs text-muted-foreground">
                      {t('gitReview.diff.binaryUnavailable')}
                    </div>
                  ) : patch ? (
                    <DiffBlock
                      diff={patch}
                      className="border-t border-border/30"
                      maxHeight="320px"
                    />
                  ) : (
                    <div className="px-3 pb-3 text-xs text-muted-foreground">
                      {t('gitReview.changePreview.noPatchPreview')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 border-t border-border/30 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
            className="gap-1 text-[0.6875rem]"
          >
            <ChevronLeft className="size-3" />
            {t('common.actions.prev')}
          </Button>
          <span className="text-[0.6875rem] text-muted-foreground">
            {t('gitReview.changePreview.pageStatus', { page: page + 1, pageCount })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={page >= pageCount - 1}
            className="gap-1 text-[0.6875rem]"
          >
            {t('common.actions.next')}
            <ChevronRight className="size-3" />
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('gitReview.changePreview.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {risk.message ?? t('gitReview.changePreview.confirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirm
                setConfirm(null)
                if (target) void runApply(target, true)
              }}
            >
              {t('gitReview.changePreview.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
