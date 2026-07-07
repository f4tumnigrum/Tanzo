import { useState } from 'react'
import { AlertTriangle, ChevronRight, CircleSlash, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ShimmerText, ToolMetaChip, ToolPreformatted } from '../tool/primitives'
import type { RunNotice as RunNoticeData } from '../../model'

export interface RunNoticeProps {
  notice: RunNoticeData

  onRetry?: () => void
  onDismiss?: () => void
}

function NoticeSeparator({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-l from-border to-transparent" aria-hidden />
      {children}
      <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden />
    </div>
  )
}

function DetailGrid({
  rows,
  dim = false
}: {
  rows: Array<{ label: string; value: string }>
  dim?: boolean
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/15 bg-secondary/18">
      <dl className="divide-y divide-border/8">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(4.5rem,0.28fr)_1fr] gap-2 px-2.5 py-1.25"
          >
            <dt
              title={row.label}
              className={cn(
                'truncate font-mono text-[length:var(--code-font-size-xs)] leading-[1.5]',
                dim ? 'text-muted-foreground/50' : 'text-muted-foreground/80'
              )}
            >
              {row.label}
            </dt>
            <dd
              className={cn(
                'min-w-0 break-words font-mono text-[length:var(--code-font-size-sm)] leading-[1.5]',
                dim ? 'text-muted-foreground/55' : 'text-foreground/82'
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function RunNotice({ notice, onRetry, onDismiss }: RunNoticeProps): React.JSX.Element {
  const { t } = useTranslation()
  const [expandedNoticeKey, setExpandedNoticeKey] = useState<string | null>(null)

  if (notice.kind === 'aborted') {
    return (
      <div role="status" aria-live="polite" className="my-5">
        <NoticeSeparator>
          <span className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] tracking-wide text-muted-foreground">
            <CircleSlash className="size-3 shrink-0" strokeWidth={2} />
            {t('chat.runNotice.aborted.title')}
          </span>
        </NoticeSeparator>
      </div>
    )
  }

  if (notice.kind === 'retry') {
    const retryLabel =
      notice.maxRetries !== undefined
        ? t('chat.runNotice.retry.titleWithMax', {
            count: notice.retryNumber,
            max: notice.maxRetries
          })
        : t('chat.runNotice.retry.title', { count: notice.retryNumber })
    return (
      <div role="status" aria-live="polite" className="my-5">
        <NoticeSeparator>
          <ShimmerText text={retryLabel} className="shrink-0 text-[0.6875rem] tracking-wide" />
        </NoticeSeparator>
      </div>
    )
  }

  const error = notice.error

  const noticeKey = `error:${error.kind}:${error.statusCode ?? ''}:${error.message}`
  const expanded = expandedNoticeKey === noticeKey

  const heading = t(`chat.runNotice.error.kind.${error.kind}`, {
    defaultValue: t('chat.runNotice.error.title')
  })

  const detailRows: Array<{ label: string; value: string }> = []
  const debugRows: Array<{ label: string; value: string }> = []
  const addRow = (
    rows: Array<{ label: string; value: string }>,
    key: string,
    value: string | number | boolean | undefined
  ): void => {
    if (value === undefined) return
    rows.push({ label: t(`chat.runNotice.error.detail.${key}`), value: String(value) })
  }

  addRow(detailRows, 'name', error.name)
  addRow(detailRows, 'provider', error.provider)
  addRow(detailRows, 'modelId', error.modelId)
  addRow(detailRows, 'statusCode', error.statusCode)
  addRow(
    detailRows,
    'retryable',
    error.retryable === undefined
      ? undefined
      : t(`chat.runNotice.error.boolean.${error.retryable ? 'yes' : 'no'}`)
  )
  addRow(detailRows, 'attempts', error.attempts)
  addRow(
    detailRows,
    'reason',
    error.reason ? t(`chat.runNotice.error.reason.${error.reason}`) : undefined
  )
  addRow(
    detailRows,
    'cause',
    error.cause
      ? error.cause.name
        ? `${error.cause.name}: ${error.cause.message}`
        : error.cause.message
      : undefined
  )

  addRow(debugRows, 'toolName', error.toolName)
  addRow(debugRows, 'toolCallId', error.toolCallId)

  const modelSummary = [error.provider, error.modelId].filter(Boolean).join('/') || undefined
  const showRetry = Boolean(onRetry && error.retryable !== false)

  return (
    <div role="alert" aria-live="assertive" className="my-5">
      <div className="not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/85 shadow-sm backdrop-blur-sm">
        <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5">
          <button
            type="button"
            onClick={() =>
              setExpandedNoticeKey((value) => (value === noticeKey ? null : noticeKey))
            }
            aria-expanded={expanded}
            className="group/notice flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 overflow-hidden whitespace-nowrap text-left"
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <AlertTriangle className="size-3.5 shrink-0 text-red-500/80" strokeWidth={2} />
            </span>
            <span className="shrink-0 text-[0.75rem] font-medium text-foreground/72 transition-colors group-hover/notice:text-foreground">
              {heading}
            </span>
            {notice.stale ? <ToolMetaChip text={t('chat.runNotice.error.stale')} /> : null}
            {error.statusCode !== undefined ? (
              <ToolMetaChip text={String(error.statusCode)} />
            ) : null}
            {modelSummary ? (
              <span className="min-w-0 truncate font-mono text-[0.625rem] text-foreground/38 transition-colors group-hover/notice:text-foreground/56">
                <bdi>{modelSummary}</bdi>
              </span>
            ) : null}
            {error.attempts !== undefined ? (
              <ToolMetaChip
                text={t('chat.runNotice.error.summary.attempts', { count: error.attempts })}
              />
            ) : null}
            <ChevronRight
              aria-hidden
              className={cn(
                'ml-auto size-3 shrink-0 text-muted-foreground/80 transition-transform group-hover/notice:text-foreground',
                expanded && 'rotate-90'
              )}
            />
          </button>
          {showRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-md border border-border/20 px-1.5 py-0.5',
                'text-[0.625rem] font-medium text-foreground/64 transition-colors',
                'hover:border-border/40 hover:bg-foreground/[0.04] hover:text-foreground',
                'focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:outline-none'
              )}
            >
              <RotateCcw className="size-2.5" strokeWidth={2.2} />
              {t('chat.runNotice.error.retryAction')}
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div className="space-y-1.5 border-t border-border/10 px-2.5 py-2">
            {detailRows.length > 0 ? <DetailGrid rows={detailRows} /> : null}
            <div className="px-1 text-[0.5625rem] uppercase tracking-[0.08em] text-muted-foreground/70">
              {t('chat.runNotice.error.detail.message')}
            </div>
            <ToolPreformatted tone="danger" maxHeight="192px">
              {error.message}
            </ToolPreformatted>
            {debugRows.length > 0 ? <DetailGrid rows={debugRows} dim /> : null}
            {onDismiss ? (
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="text-[0.625rem] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                >
                  {t('chat.runNotice.error.dismissAction')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
