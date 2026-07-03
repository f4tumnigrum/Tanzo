import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { createContext, use, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react'
import { useTheme } from '@/components/theme/theme-provider'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { SyntaxHighlighter, resolveLanguage } from '../tool/primitives/syntax'
import { COPY_FEEDBACK_TIMEOUT } from '../tool/primitives/copy-constants'

interface CodeBlockContextType {
  code: string
  copyCode?: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({ code: '' })

export interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
  code: string
  language: string
  showLineNumbers?: boolean
  maxHeight?: string
  copyCode?: string
  showHeader?: boolean
}

export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  maxHeight,
  copyCode,
  showHeader = true,
  className,
  children,
  ...props
}: CodeBlockProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const syntaxLanguage = resolveLanguage(language)
  const containerMaxHeight = maxHeight || '280px'
  const style = resolvedTheme === 'dark' ? oneDark : oneLight
  const languageLabel = (language || 'text').trim().toLowerCase() || 'text'

  const contextValue = useMemo<CodeBlockContextType>(
    () => (copyCode === undefined ? { code } : { code, copyCode }),
    [code, copyCode]
  )

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <div
        className={cn(
          'group relative w-full max-w-full overflow-hidden rounded-md bg-muted/30',
          className
        )}
        style={{ maxHeight: containerMaxHeight }}
        {...props}
      >
        {showHeader && (
          <div
            className="flex h-8 items-center justify-between bg-muted/25 px-3"
            data-code-block-header="true"
          >
            <div className="min-w-0">
              <span className="block truncate font-mono text-[0.6875rem] tracking-[0.02em] text-foreground/65 lowercase">
                {languageLabel}
              </span>
            </div>
            {children && <div className="flex items-center gap-1">{children}</div>}
          </div>
        )}
        <div
          className="scrollbar-subtle overflow-x-hidden overflow-y-auto"
          style={{
            maxHeight: showHeader ? `calc(${containerMaxHeight} - 32px)` : containerMaxHeight
          }}
        >
          <SyntaxHighlighter
            className="overflow-x-hidden !bg-transparent"
            codeTagProps={{ className: 'font-mono' }}
            customStyle={{
              margin: 0,
              padding: '0.625rem',
              fontSize: 'var(--code-font-size)',
              background: 'transparent',
              color: 'color-mix(in oklab, var(--foreground) 85%, transparent)',
              maxWidth: '100%',
              overflowX: 'hidden'
            }}
            language={syntaxLanguage}
            lineNumberStyle={{
              color: 'color-mix(in oklab, var(--muted-foreground) 40%, transparent)',
              paddingRight: '0.5rem',
              minWidth: '1.25rem',
              fontSize: 'calc(var(--code-font-size) * 0.91)'
            }}
            showLineNumbers={showLineNumbers}
            style={style}
            wrapLines
            wrapLongLines
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export interface CodeBlockCopyButtonProps {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
  children?: ReactNode
  className?: string
}

export function CodeBlockCopyButton({
  onCopy,
  onError,
  timeout = COPY_FEEDBACK_TIMEOUT,
  children,
  className
}: CodeBlockCopyButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const [isCopied, setIsCopied] = useState(false)
  const { code, copyCode } = use(CodeBlockContext)

  const copyToClipboard = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyCode ?? code)
      setIsCopied(true)
      onCopy?.()
      window.setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon
  const tooltipLabel = isCopied ? t('chat.message.copy.copied') : t('chat.message.copy.code')

  return (
    <Tooltip>
      <TooltipTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            className={cn(
              'h-6 w-6 shrink-0 rounded-md border border-transparent bg-transparent text-muted-foreground/70 shadow-none transition-colors hover:border-border/60 hover:text-foreground/90 focus-visible:border-border/70',
              className
            )}
            onClick={() => void copyToClipboard()}
            size="icon"
            variant="ghost"
            aria-label={tooltipLabel}
          >
            {children ?? (
              <Icon size={12} className={cn('transition-all', isCopied && 'text-emerald-500')} />
            )}
          </Button>
        )}
      />
      <TooltipContent side="top">{tooltipLabel}</TooltipContent>
    </Tooltip>
  )
}
