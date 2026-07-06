import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine,
  Download,
  ExternalLink,
  GitBranch,
  Plus,
  ShieldCheck,
  Upload
} from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GitReviewController } from '../model'
import {
  FIELD_CLASSNAME,
  GIT_DIALOG_BUTTON_CLASSNAME,
  GIT_DIALOG_GHOST_BUTTON_CLASSNAME,
  GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME,
  GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME,
  GIT_DIALOG_SPLIT_CLASSNAME,
  GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME,
  GIT_DIALOG_TYPO_ACTION_CLASSNAME,
  GIT_DIALOG_TYPO_BODY_CLASSNAME,
  GIT_DIALOG_TYPO_CODE_META_CLASSNAME,
  GIT_DIALOG_TYPO_HEADING_CLASSNAME,
  GIT_DIALOG_TYPO_ITEM_CLASSNAME,
  GIT_DIALOG_TYPO_LABEL_CLASSNAME,
  GIT_DIALOG_TYPO_META_CLASSNAME,
  RefDelta,
  SIDEBAR_ROW_CLASSNAME
} from './git-dialog-shared'

function SyncOptionPill({
  active,
  onToggle,
  disabled,
  children
}: {
  readonly active: boolean
  readonly onToggle: () => void
  readonly disabled?: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'h-7 rounded-[var(--radius-4xl)] border-0 px-2.5 text-[0.6875rem] font-medium shadow-none transition-colors',
        active
          ? 'bg-destructive/12 text-destructive hover:bg-destructive/16 hover:text-destructive dark:bg-destructive/20 dark:hover:bg-destructive/25'
          : 'bg-transparent text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/10'
      )}
    >
      {children}
    </Button>
  )
}

/**
 * Guidance shown when the workspace is on a detached HEAD. New commits made here
 * can be lost, so we surface a one-tap "create branch here" affordance instead
 * of silently letting the user commit into a doomed state.
 */
function DetachedBanner({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [branchName, setBranchName] = useState('')
  const creating = controller.isPending('createBranch')

  return (
    <div className="rounded-[min(var(--radius-md),10px)] border border-amber-500/30 bg-amber-500/[0.08] p-3">
      <div className="flex items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-amber-500" />
        <span
          className={cn(GIT_DIALOG_TYPO_HEADING_CLASSNAME, 'text-amber-600 dark:text-amber-400')}
        >
          {t('gitReview.detached.title')}
        </span>
      </div>
      <p className={cn('mt-1', GIT_DIALOG_TYPO_BODY_CLASSNAME, 'text-foreground/60')}>
        {t('gitReview.detached.detail')}
      </p>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void controller.createBranch(branchName).then((created) => {
            if (created) setBranchName('')
          })
        }}
      >
        <Input
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          placeholder={t('gitReview.detached.branchName')}
          className={FIELD_CLASSNAME}
        />
        <Button
          type="submit"
          size="sm"
          disabled={creating || !branchName.trim()}
          className={cn(GIT_DIALOG_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME, 'shrink-0')}
        >
          <Plus className="size-3.5" />
          {t('gitReview.detached.createBranch')}
        </Button>
      </form>
    </div>
  )
}

export function SyncView({
  controller
}: {
  readonly controller: GitReviewController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [remote, setRemote] = useState(controller.remotes[0]?.name ?? 'origin')
  const [branch, setBranch] = useState(controller.overview?.branch ?? '')
  const [forceWithLease, setForceWithLease] = useState(false)
  const [lease, setLease] = useState('')
  const [remoteName, setRemoteName] = useState('origin')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false)
  const [pullConfirmOpen, setPullConfirmOpen] = useState(false)
  const hasRemote = controller.remotes.length > 0
  const isDetached = controller.overview?.isDetached ?? false
  const ahead = controller.overview?.ahead ?? 0
  const behind = controller.overview?.behind ?? 0
  const pushTarget = `${remote || 'origin'}${branch ? `/${branch}` : ''}`
  const pullTarget = `${remote || 'origin'}${branch ? `/${branch}` : ''}`
  const fetching = controller.isPending('fetch')
  const pulling = controller.isPending('pull')
  const pushing = controller.isPending('push')

  const confirmPush = (): void => {
    setPushConfirmOpen(false)
    void controller.push({ remote, branch, forceWithLease, lease })
  }

  const confirmPull = (): void => {
    setPullConfirmOpen(false)
    void controller.pull(remote, branch)
  }

  return (
    <div className={GIT_DIALOG_SPLIT_CLASSNAME}>
      <aside className={GIT_DIALOG_SPLIT_SIDEBAR_CLASSNAME}>
        <div className={GIT_DIALOG_SIDEBAR_TOOLBAR_CLASSNAME}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
            <ExternalLink className="size-3.5 shrink-0 text-foreground/45" />
            <span className={cn('truncate', GIT_DIALOG_TYPO_HEADING_CLASSNAME)}>
              {t('gitReview.sync.remotes')}
            </span>
          </div>
          {controller.remotes.length ? (
            <span className={GIT_DIALOG_TYPO_CODE_META_CLASSNAME}>{controller.remotes.length}</span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-subtle">
          {controller.remotes.map((item) => (
            <button
              key={item.name}
              type="button"
              className={cn(
                SIDEBAR_ROW_CLASSNAME,
                remote === item.name &&
                  'bg-[color-mix(in_oklab,var(--sidebar-primary)_12%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--sidebar-primary)_20%,transparent)] dark:bg-[color-mix(in_oklab,var(--sidebar-primary)_15%,transparent)] dark:ring-[color-mix(in_oklab,var(--sidebar-primary)_24%,transparent)]'
              )}
              onClick={() => setRemote(item.name)}
            >
              <ExternalLink
                className={cn(
                  'size-3.5 shrink-0',
                  remote === item.name ? 'text-foreground/70' : 'text-foreground/38'
                )}
              />
              <div className="min-w-0 flex-1 text-left">
                <div className={cn('truncate', GIT_DIALOG_TYPO_ITEM_CLASSNAME)}>{item.name}</div>
                <div className={cn('mt-0.5 truncate', GIT_DIALOG_TYPO_CODE_META_CLASSNAME)}>
                  {item.fetchUrl}
                </div>
              </div>
            </button>
          ))}
          {!hasRemote ? (
            <div className={cn('px-2 py-4 text-center', GIT_DIALOG_TYPO_META_CLASSNAME)}>
              {t('gitReview.sync.noRemotes')}
            </div>
          ) : null}
        </div>
        <form
          className="space-y-2 border-t border-border/15 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void controller.addRemote(remoteName, remoteUrl, true)
          }}
        >
          <Input
            value={remoteName}
            onChange={(event) => setRemoteName(event.target.value)}
            placeholder={t('gitReview.sync.remoteName')}
            className={FIELD_CLASSNAME}
          />
          <Input
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder={t('gitReview.sync.remoteUrl')}
            className={FIELD_CLASSNAME}
          />
          <Button
            type="submit"
            size="sm"
            disabled={controller.isPending('addRemote') || !remoteName.trim() || !remoteUrl.trim()}
            className={cn(GIT_DIALOG_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME, 'w-full')}
          >
            <Plus className="size-3.5" />
            {t('gitReview.actions.addRemote')}
          </Button>
        </form>
      </aside>
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className={GIT_DIALOG_INSPECTOR_HEADER_CLASSNAME}>
          <ShieldCheck className="size-3.5 shrink-0 text-foreground/45" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className={cn('min-w-0 truncate', GIT_DIALOG_TYPO_ITEM_CLASSNAME)}>
              {controller.status?.head.upstream ?? t('gitReview.sync.noUpstream')}
            </div>
            <span className="shrink-0 text-foreground/20">·</span>
            <RefDelta ahead={ahead} behind={behind} className="shrink-0" />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={controller.mutating || !hasRemote}
              onClick={() => void controller.fetch(remote)}
            >
              <Download className={cn('size-3.5', fetching && 'animate-pulse')} />
              {t('gitReview.actions.fetch')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={controller.mutating || !hasRemote}
              onClick={() => setPullConfirmOpen(true)}
            >
              <ArrowDownToLine className={cn('size-3.5', pulling && 'animate-pulse')} />
              {t('gitReview.actions.pull')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(GIT_DIALOG_GHOST_BUTTON_CLASSNAME, GIT_DIALOG_TYPO_ACTION_CLASSNAME)}
              disabled={controller.mutating || !hasRemote}
              onClick={() => setPushConfirmOpen(true)}
            >
              <Upload className={cn('size-3.5', pushing && 'animate-pulse')} />
              {t('gitReview.actions.push')}
            </Button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-3 scrollbar-subtle">
          <div className="mx-auto max-w-2xl space-y-3">
            {isDetached ? <DetachedBanner controller={controller} /> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
              <Input
                value={remote}
                onChange={(event) => setRemote(event.target.value)}
                placeholder={t('gitReview.sync.remote')}
                className={FIELD_CLASSNAME}
              />
              <Input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder={t('gitReview.sync.branch')}
                className={FIELD_CLASSNAME}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(GIT_DIALOG_TYPO_LABEL_CLASSNAME, 'text-foreground/45')}>
                {t('gitReview.actions.push')}
              </span>
              <SyncOptionPill
                active={forceWithLease}
                disabled={controller.mutating}
                onToggle={() => setForceWithLease((c) => !c)}
              >
                {t('gitReview.sync.forceWithLease')}
              </SyncOptionPill>
              {forceWithLease ? (
                <Input
                  value={lease}
                  onChange={(event) => setLease(event.target.value)}
                  placeholder={t('gitReview.sync.lease')}
                  className={cn(FIELD_CLASSNAME, 'h-7 w-48')}
                />
              ) : null}
            </div>
          </div>
        </div>
      </main>

      <AlertDialog open={pullConfirmOpen} onOpenChange={setPullConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('gitReview.pull.confirmTitle', { target: pullTarget })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('gitReview.pull.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPull}>
              {t('gitReview.pull.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pushConfirmOpen} onOpenChange={setPushConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('gitReview.push.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('gitReview.push.confirmBody', { target: pushTarget })}
              {forceWithLease ? (
                <span className="mt-2 block font-medium text-destructive">
                  {t('gitReview.push.forceWarning')}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={forceWithLease ? 'destructive' : 'default'}
              onClick={confirmPush}
            >
              {forceWithLease ? t('gitReview.actions.forcePush') : t('gitReview.actions.push')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
