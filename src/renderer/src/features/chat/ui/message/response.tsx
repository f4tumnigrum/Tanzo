import { memo, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Markdown } from './markdown'

export interface ResponseProps {
  content: string
  className?: string

  renderMarkdown?: boolean

  isStreaming?: boolean
}

const MARKDOWN_FEATURE_PATTERN = /[`*_#[\]|>-]|^\s*[-*+]\s+|^\s*\d+\.\s+|https?:\/\/|<\w+[^>]*>/m

export const Response = memo(
  function Response({
    content,
    className,
    renderMarkdown = true
  }: ResponseProps): React.JSX.Element {
    const trimmed = useMemo(() => content.replace(/\n{3,}/g, '\n\n').trimEnd(), [content])
    const useMarkdown = renderMarkdown && MARKDOWN_FEATURE_PATTERN.test(trimmed)

    if (!useMarkdown) {
      return (
        <p
          className={cn(
            'whitespace-pre-wrap break-words text-[0.8125rem] leading-[var(--content-line-height)] text-foreground/88',
            className
          )}
        >
          {trimmed}
        </p>
      )
    }

    return (
      <div className={cn('relative', className)}>
        <Markdown
          content={trimmed}
          className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0')}
        />
      </div>
    )
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.className === next.className &&
    prev.renderMarkdown === next.renderMarkdown &&
    prev.isStreaming === next.isStreaming
)
