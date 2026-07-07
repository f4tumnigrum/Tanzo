import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ListOrdered, X } from 'lucide-react'
import type { TanzoDataParts } from '@shared/agent-message'
import { cn } from '@/lib/utils'
import { composeSurfaceClass } from './surface-style'

const textActionClass =
  'rounded-[var(--radius-md)] px-1 text-[0.6875rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70'

type QueuedMessage = TanzoDataParts['queued']['items'][number]

export interface QueuedMessagesProps {
  items: QueuedMessage[]
  onRemove: (id: string) => void
  onSteer: (text: string) => void
}

export function QueuedMessages({
  items,
  onRemove,
  onSteer
}: QueuedMessagesProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [userExpanded, setUserExpanded] = useState(false)

  if (items.length === 0) return null

  const hasMore = items.length > 1

  const expanded = userExpanded && hasMore

  const next = items[0]

  const steerAndRemove = (item: QueuedMessage): void => {
    onSteer(item.text)
    onRemove(item.id)
  }

  return (
    <div
      className={cn(
        composeSurfaceClass,
        'mx-auto flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-xl)] @md/chat:w-[90%]',
        'bg-[color-mix(in_oklab,var(--card)_95%,transparent)] backdrop-blur-2xl backdrop-saturate-150'
      )}
    >
      {/* Header bar: collapsed shows the next-up message; expanded shows a label. */}
      <div className="flex h-7 items-center gap-2 px-3 text-secondary-foreground/70">
        {hasMore ? (
          <button
            type="button"
            onClick={() => setUserExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-label={t('chat.composer.queuedTitle')}
            className="flex min-w-0 flex-1 items-center gap-2 text-inherit transition-colors hover:text-secondary-foreground"
          >
            <ListOrdered className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.9} />
            {expanded ? (
              <span className="text-xs font-medium">{t('chat.composer.queuedTitle')}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-left text-xs text-foreground/85">
                {next.text}
              </span>
            )}
            <span className="shrink-0 rounded-[var(--radius-4xl)] bg-foreground/8 px-1.5 font-mono text-[0.625rem] leading-[1.15rem] tabular-nums text-muted-foreground/70">
              {items.length}
            </span>
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3 shrink-0 text-muted-foreground/55 transition-transform duration-200',
                expanded ? 'rotate-180' : 'rotate-0'
              )}
              strokeWidth={2}
            />
          </button>
        ) : (
          <>
            <ListOrdered className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">{next.text}</span>
          </>
        )}
        {/* Collapsed: actions target the next-up item. */}
        {!expanded ? (
          <RowActions
            steerLabel={t('chat.composer.queuedSteer')}
            removeLabel={t('chat.composer.removeQueued')}
            onSteer={() => steerAndRemove(next)}
            onRemove={() => onRemove(next.id)}
          />
        ) : null}
      </div>

      {/* Expanded list: smooth height reveal matching the todo panel motion. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <ul className="flex flex-col border-t border-border/30 py-1">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="group/row flex h-7 items-center gap-2 px-3 transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="w-3 shrink-0 text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground/45">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
                  {item.text}
                </span>
                <RowActions
                  steerLabel={t('chat.composer.queuedSteer')}
                  removeLabel={t('chat.composer.removeQueued')}
                  onSteer={() => steerAndRemove(item)}
                  onRemove={() => onRemove(item.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

interface RowActionsProps {
  steerLabel: string
  removeLabel: string
  onSteer: () => void
  onRemove: () => void
}

function RowActions({
  steerLabel,
  removeLabel,
  onSteer,
  onRemove
}: RowActionsProps): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onSteer}
        className={cn(
          textActionClass,
          'text-amber-600/80 hover:text-amber-500 dark:text-amber-500/80'
        )}
      >
        {steerLabel}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="flex size-5 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </div>
  )
}
