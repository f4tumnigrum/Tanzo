import { cn } from '@/lib/utils'

export interface CodeViewLine {
  lineNumber?: string | number
  text: string
  tone?: 'muted' | 'normal' | 'add' | 'remove'
}

const TONE_CLASS: Record<NonNullable<CodeViewLine['tone']>, string> = {
  normal: 'text-foreground/90',
  muted: 'text-muted-foreground',
  add: 'bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300',
  remove: 'bg-red-500/[0.08] text-red-700 dark:text-red-300'
}

export interface SimpleCodeViewProps {
  lines: CodeViewLine[]
  maxLines?: number
  maxHeight?: string
  wrapLongLines?: boolean
  className?: string
  flush?: boolean
}

export function SimpleCodeView({
  lines,
  maxLines = 40,
  maxHeight = '300px',
  wrapLongLines = false,
  className,
  flush = false
}: SimpleCodeViewProps): React.JSX.Element {
  const isTruncated = lines.length > maxLines
  const displayLines = isTruncated ? lines.slice(0, maxLines) : lines
  const cellStyle = { lineHeight: '18px' }

  return (
    <div className={className}>
      <div
        className={cn(
          'scrollbar-elegant overflow-hidden bg-secondary/18',
          flush ? '' : 'rounded-[var(--radius-lg)] border border-border/15',
          wrapLongLines ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto'
        )}
        style={{ maxHeight }}
      >
        <table
          className={cn(
            'w-full border-collapse font-mono text-[length:var(--code-font-size)]',
            wrapLongLines && 'table-fixed'
          )}
        >
          <tbody>
            {displayLines.map((line, index) => (
              <tr
                key={`${line.lineNumber ?? 'line'}-${index}`}
                className={cn(
                  'group border-b border-border/8 last:border-0 hover:bg-background/24',
                  line.tone === 'add' && 'bg-emerald-500/[0.06]',
                  line.tone === 'remove' && 'bg-red-500/[0.06]'
                )}
              >
                <td
                  className="w-9 select-none border-r border-border/8 px-1.5 text-right align-top text-[length:var(--code-font-size-xs)] text-muted-foreground"
                  style={cellStyle}
                >
                  {line.lineNumber ?? ''}
                </td>
                <td
                  className={cn('pl-2 pr-1 align-top', TONE_CLASS[line.tone ?? 'normal'])}
                  style={cellStyle}
                >
                  <code
                    className={cn(
                      wrapLongLines
                        ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
                        : 'whitespace-pre'
                    )}
                  >
                    {line.text || ' '}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isTruncated && (
          <div className="border-t border-border/10 px-1.5 py-1 text-[0.5625rem] text-muted-foreground">
            +{lines.length - maxLines} lines
          </div>
        )}
      </div>
    </div>
  )
}
