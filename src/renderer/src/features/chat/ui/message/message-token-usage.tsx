import { cn } from '@/lib/utils'

export interface TokenUsageEntry {
  label: string
  value: number
}

export function MessageTokenUsage({
  entries,
  className
}: {
  entries: TokenUsageEntry[]
  className?: string
}): React.JSX.Element | null {
  const visibleEntries = entries.filter((entry) => entry.value > 0)
  if (visibleEntries.length === 0) return null

  return (
    <div
      className={cn(
        'ml-1.5 flex min-h-3.5 flex-wrap items-center gap-y-0.5 font-mono text-[0.625rem] tabular-nums lowercase text-muted-foreground/50',
        className
      )}
    >
      {visibleEntries.map((entry, i) => (
        <span key={entry.label} className="flex items-center">
          {i > 0 ? (
            <span aria-hidden className="mx-1.5 h-2.5 w-px bg-border/50 @md/chat:mx-2.5" />
          ) : null}
          <span className="opacity-65">{entry.label}</span>
          <span className="ml-1.5 text-foreground/65">{formatTokens(entry.value)}</span>
        </span>
      ))}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}m`
}
