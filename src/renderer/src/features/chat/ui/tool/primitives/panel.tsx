import { memo, useMemo, type ReactNode } from 'react'
import { Empty, EmptyContent, EmptyDescription } from '@/components/ui/empty'
import { cn } from '@/lib/utils'

export type ToolPanelTone = 'default' | 'subtle' | 'success' | 'warning' | 'danger'

const toneStyles: Record<ToolPanelTone, string> = {
  default: 'border border-border/15 bg-secondary/30',
  subtle: 'border border-border/15 bg-secondary/18',
  success: 'border border-emerald-500/25 bg-emerald-500/8',
  warning: 'border border-amber-500/25 bg-amber-500/8',
  danger: 'border border-red-500/25 bg-red-500/8'
}

export function ToolBody({
  className,
  children
}: {
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return <div className={cn('px-2.5 py-2', className)}>{children}</div>
}

export function ToolPanel({
  className,
  children,
  tone = 'default',
  flush = false
}: {
  className?: string
  children: ReactNode
  tone?: ToolPanelTone
  flush?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'overflow-hidden',
        toneStyles[tone],
        flush ? 'rounded-none border-0' : 'rounded-[var(--radius-lg)]',
        className
      )}
    >
      {children}
    </div>
  )
}

export function ToolScrollPanel({
  className,
  children,
  tone = 'default',
  maxHeight = '240px',
  contentClassName,
  flush = false
}: {
  className?: string
  children: ReactNode
  tone?: ToolPanelTone
  maxHeight?: string
  contentClassName?: string
  flush?: boolean
}): React.JSX.Element {
  return (
    <ToolPanel className={className} tone={tone} flush={flush}>
      <div
        className={cn('scrollbar-elegant overflow-auto', contentClassName)}
        style={{ maxHeight }}
      >
        {children}
      </div>
    </ToolPanel>
  )
}

const PRE_CHUNK_CHARS = 4096

const PreChunk = memo(function PreChunk({ text }: { text: string }): React.JSX.Element {
  return <span>{text}</span>
})

export const ToolPreText = memo(function ToolPreText({
  text
}: {
  text: string
}): React.JSX.Element {
  const chunks = useMemo(() => {
    if (text.length <= PRE_CHUNK_CHARS) return [text]
    const out: string[] = []
    for (let i = 0; i < text.length; i += PRE_CHUNK_CHARS) {
      out.push(text.slice(i, i + PRE_CHUNK_CHARS))
    }
    return out
  }, [text])

  return (
    <>
      {chunks.map((chunk, index) => (
        <PreChunk key={index} text={chunk} />
      ))}
    </>
  )
})

export function ToolValuePreview({
  value,
  maxItems = 8,
  maxTextLength = 320,
  maxHeight = '240px'
}: {
  value: unknown
  maxItems?: number
  maxTextLength?: number
  maxHeight?: string
}): React.JSX.Element {
  if (isScalar(value)) {
    return (
      <ToolScrollPanel tone="subtle" maxHeight={maxHeight} contentClassName="px-2.5 py-1.75">
        <ScalarValue value={value} maxTextLength={maxTextLength} />
      </ToolScrollPanel>
    )
  }

  const entries = previewEntries(value, maxItems)
  if (entries.length === 0) {
    return (
      <ToolPanel tone="subtle">
        <p className="px-2.5 py-1.75 text-[0.625rem] text-muted-foreground">—</p>
      </ToolPanel>
    )
  }

  return (
    <ToolScrollPanel tone="subtle" maxHeight={maxHeight}>
      <dl className="divide-y divide-border/8">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="grid grid-cols-[minmax(4rem,0.34fr)_1fr] gap-2 px-2.5 py-1.25"
          >
            <dt
              className="truncate font-mono text-[length:var(--code-font-size-xs)] leading-[1.5] text-muted-foreground/80"
              title={entry.label}
            >
              {entry.label}
            </dt>
            <dd className="min-w-0 text-[length:var(--code-font-size-sm)] leading-[1.5] text-foreground/82">
              <PreviewValue value={entry.value} maxTextLength={maxTextLength} />
            </dd>
          </div>
        ))}
      </dl>
    </ToolScrollPanel>
  )
}

function PreviewValue({
  value,
  maxTextLength
}: {
  value: unknown
  maxTextLength: number
}): React.JSX.Element {
  if (isScalar(value)) return <ScalarValue value={value} maxTextLength={maxTextLength} />
  return <span className="font-mono text-muted-foreground/80">{valueSummary(value)}</span>
}

function ScalarValue({
  value,
  maxTextLength
}: {
  value: string | number | boolean | null | undefined
  maxTextLength: number
}): React.JSX.Element {
  if (value === null) return <span className="font-mono text-muted-foreground/70">null</span>
  if (value === undefined)
    return <span className="font-mono text-muted-foreground/70">undefined</span>
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <span className="font-mono text-foreground/75">{String(value)}</span>
  }
  return <span className="whitespace-pre-wrap break-words">{clipText(value, maxTextLength)}</span>
}

function previewEntries(
  value: unknown,
  maxItems: number
): Array<{ key: string; label: string; value: unknown }> {
  if (Array.isArray(value)) {
    const entries = value.slice(0, maxItems).map((item, index) => ({
      key: String(index),
      label: `[${index}]`,
      value: item
    }))
    if (value.length > maxItems) {
      entries.push({ key: 'more', label: '…', value: `${value.length - maxItems} more items` })
    }
    return entries
  }
  if (!value || typeof value !== 'object') return []
  const entries = Object.entries(value as Record<string, unknown>)
  const visible = entries.slice(0, maxItems).map(([key, entryValue]) => ({
    key,
    label: key,
    value: entryValue
  }))
  if (entries.length > maxItems) {
    visible.push({ key: '__more', label: '…', value: `${entries.length - maxItems} more fields` })
  }
  return visible
}

function isScalar(value: unknown): value is string | number | boolean | null | undefined {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value)
}

function valueSummary(value: unknown): string {
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    return keys.length === 1 ? '1 field' : `${keys.length} fields`
  }
  return String(value)
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) + '…' : value
}

export function ToolPreformatted({
  className,
  children,
  tone = 'default',
  maxHeight = '240px',
  preClassName
}: {
  className?: string
  children: ReactNode
  tone?: ToolPanelTone
  maxHeight?: string
  preClassName?: string
}): React.JSX.Element {
  return (
    <ToolScrollPanel className={className} tone={tone} maxHeight={maxHeight}>
      <pre
        className={cn(
          'whitespace-pre-wrap break-words px-2.5 py-1.75 text-[length:var(--code-font-size-sm)] leading-[1.45] text-foreground/90',
          preClassName
        )}
      >
        {typeof children === 'string' ? <ToolPreText text={children} /> : children}
      </pre>
    </ToolScrollPanel>
  )
}

export function ToolMetaLine({
  className,
  children
}: {
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('px-0.5 text-[0.5625rem] text-muted-foreground', className)}>{children}</div>
  )
}

export function ToolPathLine({
  value,
  label,
  className
}: {
  value?: string
  label?: string
  className?: string
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <ToolMetaLine
      className={cn(
        'px-1 font-mono text-[length:var(--code-font-size-xs)] leading-[1.4] text-foreground/52',
        className
      )}
    >
      {label ? <span className="mr-1 text-muted-foreground/80">{label}: </span> : null}
      <span className="break-words">{value}</span>
    </ToolMetaLine>
  )
}

export function ToolEmptyState({
  message,
  className
}: {
  message: string
  className?: string
}): React.JSX.Element {
  return (
    <Empty className={cn('gap-0 border-0 px-2.5 py-2', className)}>
      <EmptyContent className="max-w-none gap-0">
        <EmptyDescription className="py-0.5 text-center text-[0.5625rem] text-muted-foreground">
          {message}
        </EmptyDescription>
      </EmptyContent>
    </Empty>
  )
}

export function ToolErrorState({
  message,
  className
}: {
  message: string
  className?: string
}): React.JSX.Element {
  return (
    <p
      className={cn(
        'whitespace-pre-wrap break-words px-1 text-[0.625rem] leading-[1.5] text-red-500/90',
        className
      )}
    >
      {message}
    </p>
  )
}
