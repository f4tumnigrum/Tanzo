import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GitReviewController } from '../model'
import {
  EmptyState,
  FIELD_CLASSNAME,
  GIT_DIALOG_BUTTON_CLASSNAME,
  GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
  GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME,
  GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME,
  GIT_DIALOG_SPLIT_CLASSNAME,
  GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME,
  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  GIT_DIALOG_TYPO_HEADING_CLASSNAME,
  GIT_DIALOG_TYPO_ITEM_CLASSNAME,
  GIT_DIALOG_TYPO_LABEL_CLASSNAME,
  GIT_DIALOG_TYPO_META_CLASSNAME,
  RefDelta,
  SIDEBAR_ROW_CLASSNAME,
  shortSha
} from './git-dialog-shared'

type BranchSelection =
  | { readonly type: 'local'; readonly name: string }
  | { readonly type: 'remote'; readonly name: string }

const SELECTED_ROW =
  'bg-[color-mix(in_oklab,var(--sidebar-primary)_12%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--sidebar-primary)_20%,transparent)] dark:bg-[color-mix(in_oklab,var(--sidebar-primary)_15%,transparent)] dark:ring-[color-mix(in_oklab,var(--sidebar-primary)_24%,transparent)]'

export function BranchesView({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [branchName, setBranchName] = useState('')
  const [startPoint, setStartPoint] = useState('')
  const [selection, setSelection] = useState<BranchSelection | null>(null)
  const remoteBranches = useMemo(
    () => controller.remoteBranches.filter((branch) => !branch.name.endsWith('/HEAD')),
    [controller.remoteBranches]
  )
  const selectedLocal =
    selection?.type === 'local'
      ? (controller.branches.find((branch) => branch.name === selection.name) ?? null)
      : null
  const selectedRemote =
    selection?.type === 'remote'
      ? (remoteBranches.find((branch) => branch.name === selection.name) ?? null)
      : null
  const selectedTitle =
    selectedLocal?.name ?? selectedRemote?.name ?? t('gitReview.states.selectBranch')

  return (
    <div className={GIT_DIALOG_SPLIT_CLASSNAME}>
      <aside className={GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME}>
        <div className={GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
            <GitBranch className="size-3.5 shrink-0 text-foreground/45" />
            <span className={cn('truncate', GIT_DIALOG_TYPO_HEADING_CLASSNAME)}>
              {t('gitReview.tabs.branches')}
            </span>
          </div>
          <span className={GIT_DIALOG_TYPO_CODE_META_CLASSNAME}>
            {controller.branches.length + remoteBranches.length}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-subtle">
          <div className="space-y-3">
            <section className="space-y-1">
              <div className="flex items-center justify-between px-2">
                <h3 className={GIT_DIALOG_TYPO_LABEL_CLASSNAME}>{t('gitReview.branch.local')}</h3>
                <span className={GIT_DIALOG_TYPO_CODE_META_CLASSNAME}>
                  {controller.branches.length}
                </span>
              </div>
              <div className="space-y-px">
                {controller.branches.map((branch) => {
                  const selected = selection?.type === 'local' && selection.name === branch.name
                  return (
                    <button
                      key={branch.name}
                      type="button"
                      className={cn(SIDEBAR_ROW_CLASSNAME, selected && SELECTED_ROW)}
                      onClick={() => setSelection({ type: 'local', name: branch.name })}
                    >
                      <GitBranch
                        className={cn(
                          'size-3.5 shrink-0',
                          branch.current
                            ? 'text-primary'
                            : selected
                              ? 'text-foreground/70'
                              : 'text-foreground/38'
                        )}
                      />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={cn('min-w-0 truncate', GIT_DIALOG_TYPO_ITEM_CLASSNAME)}>
                            {branch.name}
                          </span>
                          {branch.current ? (
                            <Badge className="h-4 px-1.5 text-[0.5625rem]">
                              {t('gitReview.branch.current')}
                            </Badge>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            'mt-0.5 flex min-w-0 items-center gap-1.5',
                            GIT_DIALOG_TYPO_META_CLASSNAME
                          )}
                        >
                          <span className="min-w-0 truncate">
                            {branch.upstream ?? t('gitReview.sync.noUpstream')}
                          </span>
                          <span className="shrink-0 text-foreground/20">·</span>
                          <RefDelta
                            ahead={branch.ahead}
                            behind={branch.behind}
                            className="shrink-0"
                          />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
            {remoteBranches.length ? (
              <section className="space-y-1">
                <div className="flex items-center justify-between px-2">
                  <h3 className={GIT_DIALOG_TYPO_LABEL_CLASSNAME}>
                    {t('gitReview.branch.remote')}
                  </h3>
                  <span className={GIT_DIALOG_TYPO_CODE_META_CLASSNAME}>
                    {remoteBranches.length}
                  </span>
                </div>
                <div className="space-y-px">
                  {remoteBranches.map((branch) => {
                    const selected = selection?.type === 'remote' && selection.name === branch.name
                    return (
                      <button
                        key={branch.name}
                        type="button"
                        className={cn(SIDEBAR_ROW_CLASSNAME, selected && SELECTED_ROW)}
                        onClick={() => setSelection({ type: 'remote', name: branch.name })}
                      >
                        <GitBranch
                          className={cn(
                            'size-3.5 shrink-0',
                            selected ? 'text-foreground/70' : 'text-foreground/38'
                          )}
                        />
                        <div className="min-w-0 flex-1 text-left">
                          <div className={cn('truncate', GIT_DIALOG_TYPO_ITEM_CLASSNAME)}>
                            {branch.name}
                          </div>
                          <div className={cn('mt-0.5', GIT_DIALOG_TYPO_CODE_META_CLASSNAME)}>
                            {shortSha(branch.headSha, t('gitReview.states.unknown'))}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <div className={GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME}>
          <GitBranch className="size-3.5 shrink-0 text-foreground/45" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className={cn('min-w-0 truncate', GIT_DIALOG_TYPO_ITEM_CLASSNAME)}>
              {selectedTitle}
            </div>
            <span className="shrink-0 text-foreground/20">·</span>
            <div className={cn('shrink-0', GIT_DIALOG_TYPO_META_CLASSNAME)}>
              {selectedLocal
                ? t('gitReview.branch.localKind')
                : selectedRemote
                  ? t('gitReview.branch.remoteKind')
                  : t('gitReview.branch.choose')}
            </div>
          </div>
          {selectedLocal ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={controller.mutating || selectedLocal.current}
              onClick={() => void controller.checkoutBranch(selectedLocal.name)}
            >
              {controller.isPending('checkout')
                ? t('common.actions.refreshing')
                : t('gitReview.actions.checkout')}
            </Button>
          ) : selectedRemote ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={controller.mutating}
              onClick={() => void controller.checkoutRemoteBranch(selectedRemote.name)}
            >
              {t('gitReview.actions.track')}
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 overflow-y-auto p-3 scrollbar-subtle">
          <div className="mx-auto max-w-2xl space-y-4">
            {selectedLocal ? (
              <div className="rounded-[min(var(--radius-md),10px)] border border-border/20 bg-muted/[0.06] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className={cn('min-w-0 flex-1 truncate', GIT_DIALOG_TYPO_CODE_CLASSNAME)}>
                    {selectedLocal.upstream ?? t('gitReview.sync.noUpstream')}
                  </div>
                  <RefDelta
                    ahead={selectedLocal.ahead}
                    behind={selectedLocal.behind}
                    className="shrink-0"
                  />
                </div>
              </div>
            ) : selectedRemote ? (
              <div className="rounded-[min(var(--radius-md),10px)] border border-border/20 bg-muted/[0.06] px-3 py-2">
                <div className={cn('truncate', GIT_DIALOG_TYPO_CODE_CLASSNAME)}>
                  {selectedRemote.headSha ?? t('gitReview.states.unknown')}
                </div>
              </div>
            ) : (
              <EmptyState icon={GitBranch} title={t('gitReview.states.selectBranch')} />
            )}
          </div>
        </div>
        <form
          className="grid shrink-0 grid-cols-1 gap-2 border-t border-border/16 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            void controller.createBranch(branchName, startPoint)
          }}
        >
          <Input
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            placeholder={t('gitReview.branch.newBranch')}
            className={FIELD_CLASSNAME}
          />
          <Input
            value={startPoint}
            onChange={(event) => setStartPoint(event.target.value)}
            placeholder={t('gitReview.branch.from')}
            className={FIELD_CLASSNAME}
          />
          <Button
            type="submit"
            size="sm"
            disabled={controller.mutating || !branchName.trim()}
            className={cn(GIT_DIALOG_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
          >
            <Plus className="size-3.5" />
            {t('gitReview.actions.create')}
          </Button>
        </form>
      </main>
    </div>
  )
}
