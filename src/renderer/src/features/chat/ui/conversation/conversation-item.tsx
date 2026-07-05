import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Item } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useChatUiStore } from '../../model/store'
import type { SidebarSessionRowModel } from '../../model/sidebar-model'

interface ConversationItemProps {
  session: SidebarSessionRowModel
  variant?: 'main' | 'branch'
  branchCount?: number
  familySessionIds?: readonly string[]
  branchSessionIds?: readonly string[]
  onSelect: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onRename?: (sessionId: string, title: string) => void
  onTogglePin?: (sessionId: string) => void
  onRequestDeleteWithBranches?: (sessionId: string, branchCount: number) => void
  onToggleBranches?: (familyId: string) => void
}

const DELETE_CONFIRM_TIMEOUT = 2000

export const ConversationItem = memo(function ConversationItem({
  session,
  variant = 'main',
  branchCount = 0,
  familySessionIds,
  branchSessionIds,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onRequestDeleteWithBranches,
  onToggleBranches
}: ConversationItemProps): React.JSX.Element {
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      clearTimeout(confirmTimerRef.current)
    },
    []
  )

  useEffect(() => {
    if (!isRenaming) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [isRenaming])

  const beginRename = useCallback(() => {
    if (!onRename) return
    clearTimeout(confirmTimerRef.current)
    setConfirmDelete(false)
    setDraftTitle(session.title)
    setIsRenaming(true)
  }, [onRename, session.title])

  const commitRename = useCallback(() => {
    setIsRenaming(false)
    const next = draftTitle.trim()
    if (next && next !== session.title) onRename?.(session.sessionId, next)
  }, [draftTitle, onRename, session.sessionId, session.title])

  const cancelRename = useCallback(() => {
    setIsRenaming(false)
  }, [])

  // Select immediately on click: selection is idempotent, so the extra select
  // fired before a double-click rename is harmless, while a debounce timer
  // would delay every conversation switch by its full window.
  const handleClick = useCallback(() => {
    onSelect(session.sessionId)
  }, [onSelect, session.sessionId])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!onRename) return
      event.preventDefault()
      event.stopPropagation()
      beginRename()
    },
    [beginRename, onRename]
  )

  const handleDeleteClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (branchCount > 0 && onRequestDeleteWithBranches) {
        onRequestDeleteWithBranches(session.sessionId, branchCount)
        return
      }
      if (confirmDelete) {
        clearTimeout(confirmTimerRef.current)
        setConfirmDelete(false)
        setIsPending(true)
        onDelete(session.sessionId)
        return
      }
      setConfirmDelete(true)
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), DELETE_CONFIRM_TIMEOUT)
    },
    [branchCount, confirmDelete, onDelete, onRequestDeleteWithBranches, session.sessionId]
  )

  const isSelected = useChatUiStore(
    useCallback((state) => state.activeChatId === session.sessionId, [session.sessionId])
  )
  const isAncestorSelected = useChatUiStore(
    useCallback(
      (state) => Boolean(state.activeChatId && branchSessionIds?.includes(state.activeChatId)),
      [branchSessionIds]
    )
  )
  const isFamilyActive = useChatUiStore(
    useCallback(
      (state) => {
        const activeChatId = state.activeChatId
        if (!activeChatId) return false
        if (activeChatId === session.sessionId) return true
        return familySessionIds?.includes(activeChatId) ?? false
      },
      [familySessionIds, session.sessionId]
    )
  )
  const isContextualActive = !isSelected && !isAncestorSelected && isFamilyActive
  const activeStateClass = isSelected
    ? 'bg-[color-mix(in_oklab,var(--sidebar-primary)_12%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--sidebar-primary)_20%,transparent)] dark:bg-[color-mix(in_oklab,var(--sidebar-primary)_15%,transparent)] dark:ring-[color-mix(in_oklab,var(--sidebar-primary)_24%,transparent)]'
    : isAncestorSelected
      ? 'bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)] dark:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)]'
      : isContextualActive
        ? 'hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]'
        : 'hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]'

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
    []
  )

  const formattedTime = useMemo(() => {
    if (!session.lastActivityAt) return ''
    const date = new Date(session.lastActivityAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    const diffHr = Math.floor(diffMs / 3_600_000)
    const diffDay = Math.floor(diffMs / 86_400_000)

    if (diffMin < 1) return t('chat.sidebar.justNow')
    if (diffMin < 60) return t('chat.sidebar.minutesAgo', { count: diffMin })
    if (diffHr < 24) return t('chat.sidebar.hoursAgo', { count: diffHr })
    if (isYesterday(date, now)) return t('chat.sidebar.yesterday')
    if (diffDay <= 7) return t('chat.sidebar.daysAgo', { count: diffDay })
    return dateFormatter.format(date)
  }, [dateFormatter, session.lastActivityAt, t])

  return (
    <Item
      role="button"
      tabIndex={0}
      aria-current={isSelected ? 'page' : undefined}
      variant="default"
      size="xs"
      className={cn(
        'group/item relative w-full min-w-0 gap-1 border-0 px-2 py-1 cursor-pointer select-none',
        'rounded-[var(--radius-md)] transition-[background-color,color,box-shadow,opacity] duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        variant === 'branch' && 'pl-2.5',
        activeStateClass,
        isPending && 'opacity-50 pointer-events-none'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'F2' && onRename) {
          event.preventDefault()
          beginRename()
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(session.sessionId)
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {session.isStreaming ? <Spinner className="size-3 shrink-0 text-foreground/60" /> : null}
        {variant === 'branch' && !session.isStreaming ? (
          <GitBranch className="size-3 shrink-0 text-foreground/50" />
        ) : null}
        {variant === 'main' && session.isPinned && !session.isStreaming ? (
          <Pin className="size-3 shrink-0 text-foreground/45" />
        ) : null}
        {isRenaming ? (
          <input
            ref={inputRef}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelRename()
              }
            }}
            className={cn(
              'min-w-0 flex-1 rounded-[var(--radius-sm)] bg-background/80 px-1 py-px',
              'text-[0.8125rem] leading-tight text-foreground outline-none',
              'ring-1 ring-[color-mix(in_oklab,var(--sidebar-primary)_40%,transparent)]'
            )}
          />
        ) : (
          <span
            className={cn(
              'truncate text-[0.8125rem] leading-tight',
              isSelected
                ? 'font-medium text-foreground'
                : isAncestorSelected
                  ? 'text-foreground/60'
                  : isContextualActive
                    ? 'text-foreground/64'
                    : 'text-foreground/78'
            )}
          >
            {session.title || t('chat.sidebar.empty')}
          </span>
        )}
        {variant === 'main' && branchCount > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleBranches?.(session.sessionId)
            }}
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px',
              'text-[0.5625rem] font-medium leading-none tracking-[0.01em] transition-colors duration-150',
              isSelected
                ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:border-indigo-400/24 dark:bg-indigo-400/12 dark:text-indigo-300'
                : 'border-indigo-500/18 bg-indigo-500/5 text-indigo-600/85 dark:border-indigo-400/14 dark:bg-indigo-400/7 dark:text-indigo-300/85',
              'hover:bg-indigo-500/12 dark:hover:bg-indigo-400/16'
            )}
          >
            <GitBranch className="size-2.5" />
            <span>{branchCount}</span>
          </button>
        ) : null}
      </div>
      {isRenaming ? null : (
        <div className="grid shrink-0 items-center [grid-template-areas:'cell']">
          <span
            className={cn(
              'justify-self-end text-[0.625rem] font-medium tabular-nums tracking-[0.01em] transition-opacity duration-150 [grid-area:cell]',
              isSelected
                ? 'text-foreground/55'
                : isAncestorSelected
                  ? 'text-foreground/30'
                  : 'text-foreground/35',
              'group-hover/item:opacity-0 group-focus-within/item:opacity-0'
            )}
          >
            {formattedTime}
          </span>
          <div
            className={cn(
              'flex items-center justify-end gap-px [grid-area:cell]',
              confirmDelete
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100',
              'transition-opacity duration-150'
            )}
          >
            {onTogglePin && variant === 'main' && !confirmDelete ? (
              <Tooltip>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      variant="ghost"
                      size="icon"
                      className="size-5 rounded-[var(--radius-sm)] text-foreground/45 transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]"
                      onClick={(event) => {
                        event.stopPropagation()
                        onTogglePin(session.sessionId)
                      }}
                      aria-label={
                        session.isPinned ? t('chat.sidebar.unpin') : t('chat.sidebar.pin')
                      }
                    >
                      {session.isPinned ? (
                        <PinOff className="size-2.5" />
                      ) : (
                        <Pin className="size-2.5" />
                      )}
                    </Button>
                  )}
                />
                <TooltipContent side="top">
                  {session.isPinned ? t('chat.sidebar.unpin') : t('chat.sidebar.pin')}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {onRename && !confirmDelete ? (
              <Tooltip>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      variant="ghost"
                      size="icon"
                      className="size-5 rounded-[var(--radius-sm)] text-foreground/45 transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]"
                      onClick={(event) => {
                        event.stopPropagation()
                        beginRename()
                      }}
                      aria-label={t('chat.sidebar.rename')}
                    >
                      <Pencil className="size-2.5" />
                    </Button>
                  )}
                />
                <TooltipContent side="top">{t('chat.sidebar.rename')}</TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={(triggerProps) => (
                  <Button
                    {...triggerProps}
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-5 rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors duration-150',
                      confirmDelete
                        ? 'text-destructive hover:bg-destructive/15'
                        : 'text-foreground/45 hover:bg-destructive/15 hover:text-destructive'
                    )}
                    onClick={handleDeleteClick}
                    aria-label={t('chat.sidebar.delete')}
                  >
                    <Trash2 className="size-2.5" />
                  </Button>
                )}
              />
              {!confirmDelete ? (
                <TooltipContent side="top">{t('chat.sidebar.delete')}</TooltipContent>
              ) : null}
            </Tooltip>
          </div>
        </div>
      )}
    </Item>
  )
})

function isYesterday(date: Date, reference: Date): boolean {
  const yesterday = new Date(reference)
  yesterday.setDate(yesterday.getDate() - 1)
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  )
}
