import { useTranslation } from 'react-i18next'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { WrapText } from 'lucide-react'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import rshCreateElement from 'react-syntax-highlighter/dist/esm/create-element'
import { useTheme } from '@/components/theme/theme-provider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useChatUiStore } from '../../../model/store'
import { PANEL_HEIGHT_LG } from './constants'
import { CopyButton } from './copy-button'
import { SyntaxHighlighter, languageFromPath } from './syntax'
import { splitDirAndFile } from '../renderers/shared'

type RNode = {
  type: 'element' | 'text'
  value?: string | number
  tagName?: string
  properties?: { className?: unknown[]; [k: string]: unknown }
  children?: RNode[]
}
type RendererProps = {
  rows: RNode[]
  stylesheet: Record<string, React.CSSProperties>
  useInlineStyles: boolean
}

const createElement = rshCreateElement as (props: {
  node: RNode
  stylesheet: Record<string, React.CSSProperties>
  useInlineStyles: boolean
  key: React.Key
}) => ReactNode

const CELL_STYLE = { lineHeight: '22px' } as const

function PassthroughTag({ children }: { children?: ReactNode }): React.JSX.Element {
  return <>{children}</>
}

function baseColor(stylesheet: Record<string, React.CSSProperties>): string | undefined {
  return (
    stylesheet['code[class*="language-"]']?.color ?? stylesheet['pre[class*="language-"]']?.color
  )
}

function WrapToggle({
  wrap,
  onToggle
}: {
  wrap: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('chat.tool.common.toggleLineWrap')
  return (
    <Tooltip>
      <TooltipTrigger
        render={(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            aria-label={label}
            aria-pressed={wrap}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className={cn(
              'flex size-5 items-center justify-center rounded-md bg-background/60 ring-1 ring-inset ring-border/15 backdrop-blur-sm transition-colors hover:text-foreground',
              wrap ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <WrapText className="size-3" />
          </button>
        )}
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function StickyPathHeader({ path }: { path: string }): React.JSX.Element {
  const { fileName, dir } = splitDirAndFile(path)
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border/10 bg-secondary/80 px-2.5 py-1.5 pr-14 font-mono text-[length:var(--code-font-size-xs)] leading-[1.4] backdrop-blur-sm">
      {dir && <span className="truncate text-foreground/40">{dir}/</span>}
      <span className="shrink-0 text-foreground/75">{fileName || path}</span>
    </div>
  )
}

export interface HighlightedCodeViewProps {
  code: string
  language?: string | undefined
  path?: string | undefined
  startLine?: number
  maxLines?: number
  maxHeight?: string
  className?: string

  flush?: boolean
  disclosureKey?: string
}

export const HighlightedCodeView = memo(function HighlightedCodeView({
  code,
  language,
  path,
  startLine = 1,
  maxLines = 120,
  maxHeight = PANEL_HEIGHT_LG,
  className,
  flush = false,
  disclosureKey
}: HighlightedCodeViewProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const storedWrap = useChatUiStore((state) =>
    disclosureKey ? state.disclosureById[disclosureKey] : undefined
  )
  const setDisclosure = useChatUiStore((state) => state.setDisclosure)
  const [localWrap, setLocalWrap] = useState(false)
  const wrap = disclosureKey ? (storedWrap ?? false) : localWrap
  const toggleWrap = (): void => {
    if (disclosureKey) setDisclosure(disclosureKey, !wrap)
    else setLocalWrap((w) => !w)
  }
  const style = resolvedTheme === 'dark' ? oneDark : oneLight
  const resolvedLanguage = language ?? languageFromPath(path)

  const allLines = useMemo(() => {
    const arr = code.split('\n')
    if (arr.length > 1 && arr[arr.length - 1] === '') arr.pop()
    return arr
  }, [code])
  const isTruncated = allLines.length > maxLines

  const renderRows = ({ rows, stylesheet, useInlineStyles }: RendererProps): ReactNode => {
    const display = isTruncated ? rows.slice(0, maxLines) : rows
    const fallback = baseColor(stylesheet)
    return display.map((node, index) => (
      <tr
        key={index}
        className="group border-b border-border/8 last:border-0 hover:bg-background/24"
      >
        <td
          className="w-9 select-none border-r border-border/8 px-1.5 text-right align-top text-[0.5625rem] text-muted-foreground"
          style={CELL_STYLE}
        >
          {startLine + index}
        </td>
        <td
          className="pl-2 pr-1 align-top"
          style={{ ...CELL_STYLE, ...(fallback ? { color: fallback } : {}) }}
        >
          <code
            className={
              wrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'whitespace-pre'
            }
          >
            {node.children?.map((child, i) =>
              createElement({ node: child, stylesheet, useInlineStyles, key: i })
            )}
          </code>
        </td>
      </tr>
    ))
  }

  return (
    <div className={cn('group/code relative', className)}>
      <div className="pointer-events-none absolute right-1 top-0.5 z-20 flex gap-1 opacity-0 transition-opacity group-hover/code:pointer-events-auto group-hover/code:opacity-100 group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100">
        <WrapToggle wrap={wrap} onToggle={toggleWrap} />
        <CopyButton text={code} />
      </div>
      <div
        className={cn(
          'scrollbar-elegant overflow-auto bg-secondary/18',
          flush ? '' : 'rounded-[var(--radius-lg)] border border-border/15',
          wrap ? 'overflow-x-hidden' : ''
        )}
        style={{ maxHeight }}
      >
        {path && <StickyPathHeader path={path} />}
        <table
          className={cn(
            'w-full border-collapse font-mono text-[length:var(--code-font-size)]',
            wrap && 'table-fixed'
          )}
        >
          <tbody>
            <SyntaxHighlighter
              language={resolvedLanguage}
              style={style}
              PreTag={PassthroughTag}
              CodeTag={PassthroughTag}
              useInlineStyles
              renderer={renderRows as never}
            >
              {code}
            </SyntaxHighlighter>
          </tbody>
        </table>
        {isTruncated && (
          <div className="border-t border-border/10 px-1.5 py-1 text-[0.5625rem] text-muted-foreground">
            +{allLines.length - maxLines} lines
          </div>
        )}
      </div>
    </div>
  )
})
