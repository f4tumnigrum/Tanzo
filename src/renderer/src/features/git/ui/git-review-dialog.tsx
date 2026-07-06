import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  GitBranch,
  GitCommitHorizontal,
  History,
  RefreshCcw,
  ShieldCheck,
  User,
  X
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { GitReviewController } from '../model'
import { BranchesView } from './git-branches-view'
import {
  EmptyState,
  FIELD_CLASSNAME,
  GIT_DIALOG_BUTTON_CLASSNAME,
  GIT_DIALOG_HEADER_BAR_CLASSNAME,
  GIT_DIALOG_HEADER_ICON_BUTTON_CLASSNAME,
  GIT_DIALOG_HEADER_PILL_CLASSNAME,
  GIT_DIALOG_TAB_LIST_CLASSNAME,
  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  GIT_DIALOG_TYPO_HEADING_CLASSNAME,
  GIT_DIALOG_TYPO_LABEL_CLASSNAME,
  GIT_DIALOG_TYPO_META_CLASSNAME,
  RefDelta,
  TAB_TRIGGER_CLASSNAME,
  formatGitUserLabel
} from './git-dialog-shared'
import { ReviewView } from './git-review-view'
import { SyncView } from './git-sync-view'
import { HistoryView } from './git-history-view'

type GitDialogView = 'review' | 'sync' | 'branches' | 'history'

interface GitReviewDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly controller: GitReviewController
}

function HeaderBranchPill({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const overview = controller.overview
  if (overview?.kind !== 'repository') {
    return (
      <div className={cn(GIT_DIALOG_HEADER_PILL_CLASSNAME, 'hidden min-w-0 md:flex')}>
        <GitBranch className="size-3 shrink-0 text-foreground/55" />
        <span className={GIT_DIALOG_TYPO_META_CLASSNAME}>
          {t('gitReview.states.notInitialized')}
        </span>
      </div>
    )
  }
  return (
    <div className={cn(GIT_DIALOG_HEADER_PILL_CLASSNAME, 'hidden max-w-[380px] min-w-0 md:flex')}>
      <GitBranch className="size-3 shrink-0 text-foreground/55" />
      <span className={cn('min-w-0 shrink-0 truncate', GIT_DIALOG_TYPO_CODE_CLASSNAME)}>
        {overview.branch ?? t('gitReview.branch.detachedHead')}
      </span>
      {controller.status?.head.upstream ? (
        <span className={cn('min-w-0 truncate', GIT_DIALOG_TYPO_CODE_META_CLASSNAME)}>
          {controller.status.head.upstream}
        </span>
      ) : null}
      {overview.ahead || overview.behind ? (
        <RefDelta ahead={overview.ahead} behind={overview.behind} className="shrink-0" />
      ) : null}
    </div>
  )
}

function GitUserPill({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [scope, setScope] = useState<'local' | 'global'>('local')
  const userLabel = formatGitUserLabel(controller.user)
  const userEmail = controller.user?.email?.trim()
  const nameValue = name.trim()
  const emailValue = email.trim()
  const canSave = Boolean(nameValue && emailValue) && !controller.mutating

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) return
    setName(controller.user?.name ?? '')
    setEmail(controller.user?.email ?? '')
    setScope('local')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              GIT_DIALOG_HEADER_ICON_BUTTON_CLASSNAME,
              'hidden max-w-[220px] w-auto gap-1.5 px-2.5 md:flex',
              !userLabel && 'text-foreground/46'
            )}
            aria-label={userLabel ? t('gitReview.identity.edit') : t('gitReview.identity.set')}
          >
            <User className="size-3 shrink-0" />
            <span
              className={cn(
                'min-w-0 truncate',
                userLabel ? GIT_DIALOG_TYPO_META_CLASSNAME : GIT_DIALOG_TYPO_ACTION_CLASSNAME
              )}
            >
              {userLabel ?? t('gitReview.identity.setShort')}
            </span>
          </Button>
        }
      />
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[320px] rounded-[min(var(--radius-lg),14px)] border border-border/35 bg-background/96 p-0 shadow-lg backdrop-blur-md"
      >
        <form
          className="space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSave) return
            void controller.setUser(nameValue, emailValue, scope).then((saved) => {
              if (saved) setOpen(false)
            })
          }}
        >
          <PopoverHeader className="gap-0.5">
            <PopoverTitle className={GIT_DIALOG_TYPO_HEADING_CLASSNAME}>
              {t('gitReview.identity.title')}
            </PopoverTitle>
            {userEmail ? (
              <p className={cn('truncate', GIT_DIALOG_TYPO_CODE_META_CLASSNAME)}>{userEmail}</p>
            ) : null}
          </PopoverHeader>
          <div className="space-y-1">
            <label className={GIT_DIALOG_TYPO_LABEL_CLASSNAME} htmlFor="git-user-name">
              {t('gitReview.identity.name')}
            </label>
            <Input
              id="git-user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="user.name"
              autoComplete="name"
              disabled={controller.mutating}
              className={FIELD_CLASSNAME}
            />
          </div>
          <div className="space-y-1">
            <label className={GIT_DIALOG_TYPO_LABEL_CLASSNAME} htmlFor="git-user-email">
              {t('gitReview.identity.email')}
            </label>
            <Input
              id="git-user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user.email"
              autoComplete="email"
              inputMode="email"
              disabled={controller.mutating}
              className={FIELD_CLASSNAME}
            />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-[min(var(--radius-md),10px)] bg-muted/[0.16] p-1">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                type="button"
                variant={scope === 'local' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-7 px-2 shadow-none',
                  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
                  scope !== 'local' &&
                    'text-foreground/56 hover:bg-background/70 hover:text-foreground'
                )}
                onClick={() => setScope('local')}
                disabled={controller.mutating}
              >
                {t('gitReview.identity.local')}
              </Button>
              <Button
                type="button"
                variant={scope === 'global' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-7 px-2 shadow-none',
                  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
                  scope !== 'global' &&
                    'text-foreground/56 hover:bg-background/70 hover:text-foreground'
                )}
                onClick={() => setScope('global')}
                disabled={controller.mutating}
              >
                {t('gitReview.identity.global')}
              </Button>
            </div>
            <Button
              type="submit"
              size="sm"
              className={cn(GIT_DIALOG_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={!canSave}
            >
              {t('common.actions.save')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export function GitReviewDialog({
  open,
  onOpenChange,
  controller
}: GitReviewDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<GitDialogView>('review')
  const [initBranch, setInitBranch] = useState('main')
  const overview = controller.overview
  const hasRepository = overview?.kind === 'repository'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="h-[min(780px,calc(100vh-1rem))] w-[calc(100vw-1rem)] !max-w-none flex flex-col gap-0 overflow-hidden rounded-lg border border-border/50 bg-background p-0 sm:h-[min(780px,calc(100vh-3rem))] sm:w-[min(1080px,calc(100vw-3rem))] sm:rounded-xl lg:w-[min(1120px,88vw)]"
      >
        <DialogTitle className="sr-only">{t('gitReview.title')}</DialogTitle>
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as GitDialogView)}
          className="flex min-h-0 flex-1 flex-col !gap-0 overflow-hidden"
        >
          <header className={GIT_DIALOG_HEADER_BAR_CLASSNAME}>
            <div className="flex min-w-0 items-center gap-1.5">
              <TabsList className={GIT_DIALOG_TAB_LIST_CLASSNAME}>
                <TabsTrigger value="review" className={TAB_TRIGGER_CLASSNAME}>
                  <GitCommitHorizontal className="size-3.5" />
                  {t('gitReview.tabs.changes')}
                </TabsTrigger>
                <TabsTrigger value="sync" className={TAB_TRIGGER_CLASSNAME}>
                  <ShieldCheck className="size-3.5" />
                  {t('gitReview.tabs.sync')}
                </TabsTrigger>
                <TabsTrigger value="branches" className={TAB_TRIGGER_CLASSNAME}>
                  <GitBranch className="size-3.5" />
                  {t('gitReview.tabs.branches')}
                </TabsTrigger>
                <TabsTrigger value="history" className={TAB_TRIGGER_CLASSNAME}>
                  <History className="size-3.5" />
                  {t('gitReview.tabs.history')}
                </TabsTrigger>
              </TabsList>
              <HeaderBranchPill controller={controller} />
              {controller.counts.conflicts > 0 ? (
                <Badge variant="destructive" className="h-5 text-[0.5625rem]">
                  {t('gitReview.counts.conflicts', { count: controller.counts.conflicts })}
                </Badge>
              ) : null}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {hasRepository && overview.isDirty ? (
                <Badge
                  variant="outline"
                  className="h-5 border-border/30 bg-background/60 text-[0.5625rem]"
                >
                  {t('gitReview.counts.changed', {
                    count:
                      controller.counts.staged +
                      controller.counts.unstaged +
                      controller.counts.untracked
                  })}
                </Badge>
              ) : null}
              {hasRepository ? <GitUserPill controller={controller} /> : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(GIT_DIALOG_HEADER_ICON_BUTTON_CLASSNAME, 'shrink-0')}
                onClick={() => void controller.refresh()}
                disabled={controller.loading}
                aria-label={t('common.actions.refresh')}
              >
                <RefreshCcw className={cn('size-3', controller.loading && 'animate-spin')} />
              </Button>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(GIT_DIALOG_HEADER_ICON_BUTTON_CLASSNAME, 'ml-1 shrink-0')}
                  >
                    <X className="size-3.5" />
                    <span className="sr-only">{t('common.actions.close')}</span>
                  </Button>
                }
              />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            {overview?.kind === 'none' ? (
              <EmptyState
                icon={GitBranch}
                title={t('gitReview.init.noRepository')}
                detail={t('gitReview.init.detail')}
                action={
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void controller.initRepository(initBranch)
                    }}
                  >
                    <Input
                      value={initBranch}
                      onChange={(event) => setInitBranch(event.target.value)}
                      placeholder={t('gitReview.init.initialBranch')}
                      className={FIELD_CLASSNAME}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className={cn(GIT_DIALOG_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
                      disabled={controller.mutating}
                    >
                      {t('gitReview.actions.initialize')}
                    </Button>
                  </form>
                }
              />
            ) : overview?.kind === 'error' ? (
              <EmptyState
                icon={AlertTriangle}
                title={t('gitReview.init.unavailable')}
                detail={overview.error ?? t('gitReview.init.statusUnavailable')}
              />
            ) : (
              <>
                <TabsContent value="review" className="h-full min-h-0 overflow-hidden">
                  <ReviewView controller={controller} />
                </TabsContent>
                <TabsContent value="sync" className="h-full min-h-0 overflow-hidden">
                  <SyncView controller={controller} />
                </TabsContent>
                <TabsContent value="branches" className="h-full min-h-0 overflow-hidden">
                  <BranchesView controller={controller} />
                </TabsContent>
                <TabsContent value="history" className="h-full min-h-0 overflow-hidden">
                  <HistoryView controller={controller} />
                </TabsContent>
              </>
            )}
          </div>
          {controller.error ? (
            <div
              className={cn(
                GIT_DIALOG_TYPO_META_CLASSNAME,
                'shrink-0 border-t border-border/16 bg-destructive/8 px-3 py-2 text-destructive'
              )}
            >
              {controller.error}
            </div>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
