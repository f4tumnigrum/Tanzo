import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, FolderOpen, Plus, Settings, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import { createLogger } from '@/common/logger'
import { useChatUiStore } from '../../model/store'
import type {
  SidebarConversationFamilyModel,
  SidebarModel,
  SidebarSessionRowModel,
  SidebarWorkspaceGroupModel
} from '../../model/sidebar-model'
import { ConversationItem } from './conversation-item'

const log = createLogger('renderer.chat')

const HEADER_ACTION_BUTTON_CLASS = cn(
  'size-7 shrink-0 rounded-[var(--radius-md)]',
  'bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] text-foreground/65 shadow-none dark:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]',
  'transition-colors duration-150',
  'hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground dark:hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]',
  'active:bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)]',
  'focus-visible:ring-2 focus-visible:ring-ring/50'
)

const GROUP_ACTION_BUTTON_CLASS = cn(
  'size-5 rounded-[var(--radius-sm)] text-foreground/45',
  'opacity-0 transition-opacity duration-150',
  'group-hover/wshdr:opacity-100 group-focus-within/wshdr:opacity-100',
  'hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-foreground/70 dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]',
  'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:opacity-100'
)

interface RemoveWorkspaceDialogState {
  open: boolean
  workspaceId: string
  workspaceName: string
  conversationCount: number
}

const INITIAL_REMOVE_WORKSPACE_DIALOG: RemoveWorkspaceDialogState = {
  open: false,
  workspaceId: '',
  workspaceName: '',
  conversationCount: 0
}

interface DeleteFamilyDialogState {
  open: boolean
  sessionId: string
  branchCount: number
}

const INITIAL_DELETE_FAMILY_DIALOG: DeleteFamilyDialogState = {
  open: false,
  sessionId: '',
  branchCount: 0
}

const EMPTY_SIDEBAR: SidebarModel = { hydrated: false, groups: [] }

type SidebarRow =
  | { type: 'workspace'; key: string; group: SidebarWorkspaceGroupModel }
  | { type: 'empty'; key: string }
  | {
      type: 'main'
      key: string
      family: SidebarConversationFamilyModel
      familySessionIds: readonly string[]
      branchSessionIds: readonly string[]
    }
  | {
      type: 'branch'
      key: string
      familyId: string
      branch: SidebarSessionRowModel
      familySessionIds: readonly string[]
      isExpanded: boolean
      isLast: boolean
    }

const sidebarRowKey = (row: SidebarRow): string => row.key

export interface ConversationSidebarProps {
  sidebar?: SidebarModel
  onConversationSelect: (sessionId: string) => void
  onConversationDelete: (sessionId: string) => void
  onConversationRename?: (sessionId: string, title: string) => void
  onWorkspaceRemove?: (workspaceId: string) => void
  onWorkspaceConversationCreate?: (workspaceId: string) => void | Promise<void>
  onPickWorkspace?: () => Promise<void>
  onNewConversation?: () => Promise<void>
  onToggleWorkspaceExpanded?: (key: string) => void
  className?: string
}

type BranchSidebarRow = Extract<SidebarRow, { type: 'branch' }>

const BranchRow = memo(function BranchRow({
  row,
  onConversationSelect,
  onConversationDelete,
  onConversationRename
}: {
  row: BranchSidebarRow
  onConversationSelect: (sessionId: string) => void
  onConversationDelete: (sessionId: string) => void
  onConversationRename?: (sessionId: string, title: string) => void
}): React.JSX.Element {
  return (
    <div className="ml-2 px-1 pb-0.5 pl-4">
      <div className="relative">
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -left-4 border-l border-border/55',
            row.isLast ? 'top-0 h-1/2' : 'top-[-2px] bottom-[-2px]'
          )}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -left-4 top-1/2 w-4 border-t border-border/55"
        />
        <ConversationItem
          session={row.branch}
          variant="branch"
          familySessionIds={row.familySessionIds}
          onSelect={onConversationSelect}
          onDelete={onConversationDelete}
          onRename={onConversationRename}
        />
      </div>
    </div>
  )
})

const SidebarEmptyState = memo(function SidebarEmptyState({
  onOpenWorkspace,
  isPicking
}: {
  onOpenWorkspace?: () => void | Promise<void>
  isPicking: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={FolderOpen}
      title={t('chat.sidebar.emptyState.title')}
      description={t('chat.sidebar.emptyState.description')}
      className="h-full px-4"
      action={
        onOpenWorkspace ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onOpenWorkspace()}
            disabled={isPicking}
          >
            {isPicking ? <Spinner className="size-3.5" /> : <FolderOpen className="size-3.5" />}
            {t('chat.sidebar.emptyState.action')}
          </Button>
        ) : undefined
      }
    />
  )
})

export function ConversationSidebar({
  sidebar = EMPTY_SIDEBAR,
  onConversationSelect,
  onConversationDelete,
  onConversationRename,
  onWorkspaceRemove,
  onWorkspaceConversationCreate,
  onPickWorkspace,
  onNewConversation,
  onToggleWorkspaceExpanded,
  className
}: ConversationSidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const activeChatId = useChatUiStore((state) => state.activeChatId)
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [expandedBranchFamilies, setExpandedBranchFamilies] = useState<Record<string, boolean>>({})
  const [removeWorkspaceDialog, setRemoveWorkspaceDialog] = useState<RemoveWorkspaceDialogState>(
    INITIAL_REMOVE_WORKSPACE_DIALOG
  )
  const [deleteFamilyDialog, setDeleteFamilyDialog] = useState<DeleteFamilyDialogState>(
    INITIAL_DELETE_FAMILY_DIALOG
  )

  const handlePickWorkspace = useCallback(async () => {
    if (isPickingWorkspace || !onPickWorkspace) return
    setIsPickingWorkspace(true)
    try {
      await onPickWorkspace()
    } catch (error) {
      log.error('failed to open workspace', error)
    } finally {
      setIsPickingWorkspace(false)
    }
  }, [isPickingWorkspace, onPickWorkspace])

  const handleNewConversation = useCallback(async () => {
    if (onNewConversation) {
      await onNewConversation()
    } else {
      await handlePickWorkspace()
    }
  }, [onNewConversation, handlePickWorkspace])

  const closeRemoveWorkspaceDialog = useCallback(() => {
    setRemoveWorkspaceDialog(INITIAL_REMOVE_WORKSPACE_DIALOG)
  }, [])

  const closeDeleteFamilyDialog = useCallback(() => {
    setDeleteFamilyDialog(INITIAL_DELETE_FAMILY_DIALOG)
  }, [])

  const handleRequestDeleteWithBranches = useCallback((sessionId: string, branchCount: number) => {
    setDeleteFamilyDialog({ open: true, sessionId, branchCount })
  }, [])

  const toggleBranches = useCallback((familyId: string) => {
    setExpandedBranchFamilies((previous) => ({
      ...previous,
      [familyId]: !previous[familyId]
    }))
  }, [])

  const rows = useMemo<SidebarRow[]>(() => {
    if (!sidebar.hydrated || sidebar.groups.length === 0) return []
    const next: SidebarRow[] = []
    for (const group of sidebar.groups) {
      next.push({ type: 'workspace', key: `workspace:${group.key}`, group })
      if (!group.isExpanded) continue
      if (group.families.length === 0) {
        next.push({ type: 'empty', key: `empty:${group.key}` })
        continue
      }
      for (const family of group.families) {
        const branchSessionIds = family.branches.map((branch) => branch.sessionId)
        const familySessionIds = [family.mainSession.sessionId, ...branchSessionIds]
        next.push({
          type: 'main',
          key: `main:${family.familyId}`,
          family,
          familySessionIds,
          branchSessionIds
        })
        if (family.branchCount === 0) continue
        const isExpanded = expandedBranchFamilies[family.familyId] ?? false
        const isFamilyActive = Boolean(activeChatId && familySessionIds.includes(activeChatId))
        if (!isExpanded && !isFamilyActive) continue
        family.branches.forEach((branch, index) => {
          next.push({
            type: 'branch',
            key: `branch:${branch.sessionId}`,
            familyId: family.familyId,
            branch,
            familySessionIds,
            isExpanded,
            isLast: index === family.branches.length - 1
          })
        })
      }
    }
    return next
  }, [activeChatId, expandedBranchFamilies, sidebar])

  const renderRow = useCallback(
    (row: SidebarRow) => {
      if (row.type === 'workspace') {
        const { group } = row
        return (
          <div className="px-1.5 pt-1">
            <div
              role="button"
              tabIndex={0}
              className={cn(
                'group/wshdr flex shrink-0 cursor-pointer items-center gap-1 px-2.5 py-1',
                'select-none rounded-[var(--radius-md)]',
                'transition-colors duration-150',
                group.isActive
                  ? ''
                  : 'hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]',
                group.isExpanded && 'mb-1'
              )}
              onClick={() => onToggleWorkspaceExpanded?.(group.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggleWorkspaceExpanded?.(group.key)
                }
              }}
            >
              <ChevronDown
                className={cn(
                  'size-3 shrink-0 transition-transform duration-200',
                  group.isActive ? 'text-foreground/65' : 'text-foreground/20',
                  !group.isExpanded && '-rotate-90'
                )}
              />
              <span
                className={cn(
                  'truncate text-[0.6875rem] font-medium tracking-[0.01em]',
                  group.isActive ? 'text-foreground' : 'text-foreground/35'
                )}
              >
                {group.workspaceName}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-px text-[0.5625rem] font-medium leading-none tabular-nums tracking-[0.01em]',
                  group.isActive
                    ? 'border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-[color-mix(in_oklab,var(--background)_44%,transparent)] text-foreground/68 dark:bg-[color-mix(in_oklab,var(--background)_42%,transparent)] dark:text-foreground/62'
                    : 'border-[color-mix(in_oklab,var(--border)_18%,transparent)] bg-[color-mix(in_oklab,var(--background)_24%,transparent)] text-foreground/28 dark:bg-[color-mix(in_oklab,var(--background)_22%,transparent)] dark:text-foreground/24'
                )}
              >
                {group.sessionCount}
              </span>

              <div className="ml-auto flex items-center gap-px">
                {onWorkspaceConversationCreate ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={(triggerProps) => (
                        <Button
                          {...triggerProps}
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(event) => {
                            event.stopPropagation()
                            void onWorkspaceConversationCreate(group.workspaceId)
                          }}
                          className={GROUP_ACTION_BUTTON_CLASS}
                          aria-label={t('chat.sidebar.newWorkspaceConversation')}
                        >
                          <Plus className="size-3" />
                        </Button>
                      )}
                    />
                    <TooltipContent side="top">
                      {t('chat.sidebar.newWorkspaceConversation')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {onWorkspaceRemove ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={(triggerProps) => (
                        <Button
                          {...triggerProps}
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(event) => {
                            event.stopPropagation()
                            setRemoveWorkspaceDialog({
                              open: true,
                              workspaceId: group.workspaceId,
                              workspaceName: group.workspaceName,
                              conversationCount: group.sessionCount
                            })
                          }}
                          className={cn(GROUP_ACTION_BUTTON_CLASS, 'hover:text-destructive')}
                          aria-label={t('chat.sidebar.removeWorkspaceAction')}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                    />
                    <TooltipContent side="top">
                      {t('chat.sidebar.removeWorkspaceAction')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </div>
        )
      }

      if (row.type === 'empty') {
        return <p className="px-3 py-2 text-xs text-foreground/50">{t('chat.sidebar.empty')}</p>
      }

      if (row.type === 'main') {
        const { family } = row
        return (
          <div className="px-1 pb-0.5">
            <ConversationItem
              session={family.mainSession}
              branchCount={family.branchCount}
              familySessionIds={row.familySessionIds}
              branchSessionIds={row.branchSessionIds}
              onSelect={onConversationSelect}
              onDelete={onConversationDelete}
              onRename={onConversationRename}
              onRequestDeleteWithBranches={handleRequestDeleteWithBranches}
              onToggleBranches={() => toggleBranches(family.familyId)}
            />
          </div>
        )
      }

      return (
        <BranchRow
          row={row}
          onConversationSelect={onConversationSelect}
          onConversationDelete={onConversationDelete}
          onConversationRename={onConversationRename}
        />
      )
    },
    [
      handleRequestDeleteWithBranches,
      onConversationDelete,
      onConversationRename,
      onConversationSelect,
      onToggleWorkspaceExpanded,
      onWorkspaceConversationCreate,
      onWorkspaceRemove,
      t,
      toggleBranches
    ]
  )

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header className="flex shrink-0 items-center gap-1.5 px-3 pt-3 pb-2">
        <button
          type="button"
          className={cn(
            'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)]',
            'bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] dark:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]',
            'text-sm text-foreground/65',
            'hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground dark:hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]',
            'active:bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)]',
            'transition-colors duration-150'
          )}
          onClick={() => void handleNewConversation()}
        >
          <Plus className="size-3" />
          {t('chat.sidebar.newConversation')}
        </button>
        {onPickWorkspace ? (
          <Tooltip>
            <TooltipTrigger
              render={(triggerProps) => (
                <Button
                  {...triggerProps}
                  variant="ghost"
                  size="icon"
                  className={HEADER_ACTION_BUTTON_CLASS}
                  onClick={handlePickWorkspace}
                  disabled={isPickingWorkspace}
                  aria-label={t('chat.sidebar.openWorkspace')}
                >
                  {isPickingWorkspace ? (
                    <Spinner className="size-4" />
                  ) : (
                    <FolderOpen className="size-4" />
                  )}
                </Button>
              )}
            />
            <TooltipContent side="bottom">{t('chat.sidebar.openWorkspace')}</TooltipContent>
          </Tooltip>
        ) : null}
      </header>
      <div
        className="min-h-0 flex-1"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)'
        }}
      >
        {!sidebar.hydrated ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="size-5 text-foreground/40" />
          </div>
        ) : sidebar.groups.length === 0 ? (
          <SidebarEmptyState
            onOpenWorkspace={onPickWorkspace ? handlePickWorkspace : undefined}
            isPicking={isPickingWorkspace}
          />
        ) : (
          <div className="scrollbar-subtle h-full overflow-y-auto">
            {rows.map((row) => (
              <div key={sidebarRowKey(row)} className="[content-visibility:auto]">
                {renderRow(row)}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          className={cn(
            'flex h-7 flex-1 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5',
            'text-sm text-foreground/65',
            'transition-colors duration-150',
            'hover:text-foreground active:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          )}
          onClick={() => navigate('/settings')}
        >
          <Settings className="size-4" />
          {t('nav.items.settings')}
        </button>
      </footer>
      <AlertDialog
        open={removeWorkspaceDialog.open}
        onOpenChange={(open) => {
          if (!open) closeRemoveWorkspaceDialog()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('chat.sidebar.removeWorkspace.title', {
                group: removeWorkspaceDialog.workspaceName
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('chat.sidebar.removeWorkspace.description', {
                count: removeWorkspaceDialog.conversationCount
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeWorkspaceDialog.workspaceId) {
                  onWorkspaceRemove?.(removeWorkspaceDialog.workspaceId)
                }
                closeRemoveWorkspaceDialog()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.actions.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteFamilyDialog.open}
        onOpenChange={(open) => {
          if (!open) closeDeleteFamilyDialog()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.sidebar.deleteFamily.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chat.sidebar.deleteFamily.description', {
                count: deleteFamilyDialog.branchCount
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteFamilyDialog.sessionId) {
                  onConversationDelete(deleteFamilyDialog.sessionId)
                }
                closeDeleteFamilyDialog()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
