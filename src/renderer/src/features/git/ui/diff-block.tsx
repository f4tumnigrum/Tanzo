import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'
import { memo, useMemo } from 'react'
import { parseDiff, type DiffLine } from './diff-utils'

interface DiffBlockProps extends HTMLAttributes<HTMLDivElement> {
  diff: string
  maxHeight?: string
  wrapLongLines?: boolean
}

type ContentLineType = 'addition' | 'deletion' | 'context'

const rowStyles: Record<ContentLineType, { bg: string; text: string }> = {
  addition: { bg: 'bg-emerald-500/8', text: 'text-emerald-600 dark:text-emerald-400' },
  deletion: { bg: 'bg-red-500/8', text: 'text-red-600 dark:text-red-400' },
  context: { bg: '', text: 'text-foreground/90' }
}

const prefixStyles: Record<ContentLineType, string> = {
  addition: 'text-emerald-500/70',
  deletion: 'text-red-500/70',
  context: 'text-muted-foreground'
}

const prefixMap: Record<ContentLineType, string> = {
  addition: '+',
  deletion: '-',
  context: ' '
}

const diffCellStyle = { lineHeight: '18px' }

const DiffLineRow = memo(function DiffLineRow({
  line,
  wrapLongLines
}: {
  line: DiffLine
  wrapLongLines: boolean
}) {
  const type = line.type as ContentLineType
  const lineNum = type === 'addition' ? line.newLineNumber : line.oldLineNumber
  const styles = rowStyles[type]

  return (
    <tr className={cn('group [content-visibility:auto]', styles.bg)}>
      <td
        className="w-7 pl-1 pr-1 text-right align-top select-none text-muted-foreground text-[length:var(--code-font-size-xs)]"
        style={diffCellStyle}
      >
        {lineNum ?? ''}
      </td>
      <td
        className={cn('w-2.5 text-center align-top select-none', prefixStyles[type])}
        style={diffCellStyle}
      >
        {prefixMap[type]}
      </td>
      <td className={cn('pr-1 align-top', styles.text)} style={diffCellStyle}>
        <code
          className={cn(
            wrapLongLines
              ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
              : 'whitespace-pre'
          )}
        >
          {line.content || ' '}
        </code>
      </td>
    </tr>
  )
})

export const DiffBlock = memo(function DiffBlock({
  diff,
  maxHeight = '300px',
  wrapLongLines = true,
  className,
  ...props
}: DiffBlockProps) {
  const { lines } = useMemo(() => parseDiff(diff), [diff])
  const visibleLines = useMemo(
    () => lines.filter((line) => line.type !== 'header' && line.type !== 'hunk'),
    [lines]
  )

  return (
    <div className={className} {...props}>
      <div
        className={cn(
          'scrollbar-elegant',
          wrapLongLines ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto'
        )}
        style={{ maxHeight }}
      >
        <table
          className={cn(
            'w-full border-collapse font-mono text-[length:var(--code-font-size-sm)]',
            wrapLongLines && 'table-fixed'
          )}
        >
          <tbody>
            {visibleLines.map((line, index) => (
              <DiffLineRow key={index} line={line} wrapLongLines={wrapLongLines} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
