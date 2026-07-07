import { memo, useRef, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CodeBlock, CodeBlockCopyButton } from './code-block'
import { isCitationHref, isSafeExternalHref, isSafeImageSrc } from './href-safety'
import {
  createIncrementalSplitter,
  normalizeMathDelimiters,
  splitSegments,
  type IncrementalSplitter,
  type MarkdownSegment
} from './incremental-blocks'
import { XmlTag } from './xml-tag'

export interface MarkdownProps {
  content: string
  className?: string
}

interface CitationParse {
  indices: number[] | '*'
  citation: string
}

function parseCitationLink(children: string, href: string): CitationParse | null {
  const text = String(children).trim()
  if (!isCitationHref(href)) return null
  if (text === '*') return { indices: '*', citation: href }
  if (/^[\d,\s]+$/.test(text)) {
    const indices = text
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n))
    if (indices.length > 0) return { indices, citation: href }
  }
  return null
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="my-3 text-[0.8125rem] leading-[var(--content-line-height)] text-foreground/88 first:mt-0 last:mb-0 [text-wrap:pretty]">
      {children}
    </p>
  ),

  h1: ({ children }) => (
    <h1 className="mt-5 mb-2 text-[0.9375rem] font-semibold tracking-[-0.01em] text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-[0.875rem] font-semibold tracking-[-0.008em] text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3.5 mb-1.5 text-[0.84375rem] font-semibold tracking-[-0.006em] text-foreground/95 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-[0.8125rem] font-semibold tracking-[-0.005em] text-foreground/90 first:mt-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-3 mb-1.5 text-[0.75rem] font-semibold tracking-[0.03em] text-foreground/72 uppercase first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-2.5 mb-1.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-foreground/62 uppercase first:mt-0">
      {children}
    </h6>
  ),

  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-3 space-y-1 pl-5 first:mt-0 last:mb-0',
        'list-disc marker:text-foreground/55',
        '[&_ol]:my-1.5 [&_ul]:my-1.5',
        className
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, className, start, type }) => (
    <ol
      start={start}
      type={type}
      className={cn(
        'my-3 space-y-1 pl-5 first:mt-0 last:mb-0',
        'list-decimal marker:text-foreground/55',
        '[&_ol]:my-1.5 [&_ul]:my-1.5',
        className
      )}
    >
      {children}
    </ol>
  ),
  li: ({ children, className }) => (
    <li
      className={cn(
        'text-[0.8125rem] leading-[var(--content-line-height)] text-foreground/88',
        className
      )}
    >
      {children}
    </li>
  ),

  input: ({ checked }) => (
    <Checkbox checked={checked === true} disabled className="mr-2 size-3.5 align-middle" />
  ),

  code: ({ className, children, ...props }) => {
    const text = String(children).replace(/\n$/, '')
    const match = /language-(\w+)/.exec(className ?? '')
    const isBlock = Boolean(match) || text.includes('\n')

    if (!isBlock) {
      return (
        <code
          className="rounded-[var(--radius-sm)] border border-border/60 bg-muted/50 px-1.5 py-[0.14rem] font-mono text-[0.8125em] text-foreground/92"
          {...props}
        >
          {children}
        </code>
      )
    }

    const language = match?.[1] || 'text'
    return (
      <CodeBlock
        code={text}
        language={language}
        showLineNumbers
        maxHeight="400px"
        className="my-4 first:mt-0 last:mb-0"
      >
        <CodeBlockCopyButton />
      </CodeBlock>
    )
  },
  pre: ({ children }) => <>{children}</>,

  a: ({ href, children }) => {
    const parsed = parseCitationLink(String(children), href ?? '')
    if (parsed) {
      const label = parsed.citation.split('|')[0] ?? parsed.citation
      const short =
        parsed.indices === '*'
          ? label
              .trim()
              .replace(/\.(docx?|pdf|md|txt)$/i, '')
              .slice(0, 8)
          : parsed.indices.join(',')
      return (
        <Tooltip>
          <TooltipTrigger
            render={(triggerProps) => (
              <span
                {...triggerProps}
                className="mx-0.5 inline-flex cursor-pointer items-center rounded-[var(--radius-sm)] border border-primary/30 bg-primary/[0.10] px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/[0.16]"
              >
                {short}
              </span>
            )}
          />
          <TooltipContent side="top">{parsed.citation}</TooltipContent>
        </Tooltip>
      )
    }

    if (!href || !isSafeExternalHref(href)) {
      return <span className="text-muted-foreground">{children}</span>
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary/90 underline decoration-primary/50 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary"
      >
        {children}
      </a>
    )
  },
  cite: ({ children, ...props }) => {
    const attrs = props as Record<string, unknown>
    const refId = typeof attrs['data-id'] === 'string' ? (attrs['data-id'] as string) : undefined
    const citation =
      typeof attrs['data-citation'] === 'string' ? (attrs['data-citation'] as string) : undefined
    return (
      <Tooltip>
        <TooltipTrigger
          render={(triggerProps) => (
            <span
              {...triggerProps}
              data-ref-id={refId}
              className="mx-0.5 inline-flex cursor-pointer items-center rounded-[var(--radius-sm)] border border-border/60 bg-muted/35 px-1.5 py-0.5 text-[0.6875rem] font-medium text-foreground/70 transition-colors hover:text-foreground/90"
            >
              {children}
            </span>
          )}
        />
        {citation ? <TooltipContent side="top">{citation}</TooltipContent> : null}
      </Tooltip>
    )
  },

  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-foreground/90 italic">{children}</em>,
  del: ({ children }) => <del className="text-foreground/60 line-through">{children}</del>,
  sup: ({ children }) => (
    <sup className="text-[0.6875rem] leading-none text-foreground/60">{children}</sup>
  ),
  sub: ({ children }) => (
    <sub className="text-[0.6875rem] leading-none text-foreground/60">{children}</sub>
  ),

  blockquote: ({ children }) => (
    <blockquote className="relative my-4 overflow-hidden rounded-[var(--radius-lg)] border border-border/55 bg-card/[0.38] px-4 py-3 text-[0.8125rem] leading-[var(--content-line-height)] text-foreground/82 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--background)_72%,transparent)] first:mt-0 last:mb-0 before:absolute before:top-0 before:right-4 before:left-4 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/55 before:to-transparent before:content-[''] [&_p+*]:!mt-2 [&_p]:!my-0 [&_p]:!text-foreground/82 [&_p]:leading-[var(--content-line-height)]">
      {children}
    </blockquote>
  ),

  table: ({ children }) => (
    <div className="my-4 overflow-hidden rounded-[var(--radius-lg)] border border-border/75 bg-card/30 first:mt-0 last:mb-0">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.8125rem]">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/80 bg-muted/45">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border/55">{children}</tbody>,
  tr: ({ children }) => (
    <tr className="transition-colors odd:bg-muted/[0.10] hover:bg-muted/[0.16]">{children}</tr>
  ),
  th: ({ children, className, style, ...props }) => {
    const align = (props as { align?: unknown }).align
    const cellStyle: CSSProperties = {
      ...style,
      textAlign:
        style?.textAlign ??
        (typeof align === 'string' ? (align as CSSProperties['textAlign']) : 'left')
    }
    return (
      <th
        {...props}
        className={cn(
          'border-r border-border/60 px-3 py-2.5 text-[0.6875rem] font-semibold tracking-[0.045em] text-foreground/70 uppercase last:border-r-0',
          className
        )}
        style={cellStyle}
      >
        {children}
      </th>
    )
  },
  td: ({ children, className, style, ...props }) => {
    const align = (props as { align?: unknown }).align
    const cellStyle: CSSProperties = {
      ...style,
      textAlign:
        style?.textAlign ??
        (typeof align === 'string' ? (align as CSSProperties['textAlign']) : 'left')
    }
    return (
      <td
        {...props}
        className={cn(
          'border-r border-border/45 px-3 py-2.5 text-foreground/88 last:border-r-0',
          className
        )}
        style={cellStyle}
      >
        {children}
      </td>
    )
  },

  hr: () => (
    <div className="my-4 first:mt-0 last:mb-0">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-border/85 to-transparent" />
    </div>
  ),
  img: ({ src, alt }) => {
    if (typeof src !== 'string' || !isSafeImageSrc(src)) return null
    return (
      <img
        src={src}
        alt={alt ?? ''}
        className="my-4 max-w-full rounded-[var(--radius-lg)] border border-border/75 shadow-sm first:mt-0 last:mb-0"
      />
    )
  },
  details: ({ children }) => (
    <details className="my-3 overflow-hidden rounded-[var(--radius-md)] border border-border/70 bg-muted/[0.12] first:mt-0 last:mb-0 [&[open]]:bg-muted/[0.2]">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer rounded-[var(--radius-md)] px-3 py-2.5 text-[0.8125rem] font-medium text-foreground/88 transition-colors select-none hover:text-foreground">
      {children}
    </summary>
  ),

  thinking: ({ children }: { children?: ReactNode }) => <XmlTag tag="thinking">{children}</XmlTag>,
  reasoning: ({ children }: { children?: ReactNode }) => (
    <XmlTag tag="reasoning">{children}</XmlTag>
  ),
  toolplan: ({ children }: { children?: ReactNode }) => <XmlTag tag="toolplan">{children}</XmlTag>,
  observation: ({ children }: { children?: ReactNode }) => (
    <XmlTag tag="observation">{children}</XmlTag>
  ),
  reflection: ({ children }: { children?: ReactNode }) => (
    <XmlTag tag="reflection">{children}</XmlTag>
  ),
  response: ({ children }: { children?: ReactNode }) => <XmlTag tag="response">{children}</XmlTag>
} as Components

const MarkdownBlock = memo(
  function MarkdownBlock({ content }: { content: string }): React.JSX.Element {
    return (
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    )
  },
  (prev, next) => prev.content === next.content
)

function renderSegment(segment: MarkdownSegment, key: string): ReactNode {
  if (segment.kind === 'xml') {
    return (
      <XmlTag key={key} tag={segment.tag}>
        {segment.body}
      </XmlTag>
    )
  }
  return <MarkdownBlock key={key} content={segment.content} />
}

export const Markdown = memo(
  function Markdown({ content, className }: MarkdownProps): React.JSX.Element | null {
    const splitterRef = useRef<IncrementalSplitter | null>(null)
    if (!content) return null

    splitterRef.current ??= createIncrementalSplitter()
    const { frozen, tail } = splitterRef.current.update(content)
    const tailSegments = tail ? splitSegments(normalizeMathDelimiters(tail)) : []

    return (
      <div
        className={cn(
          'markdown-content antialiased [font-variant-numeric:tabular-nums]',
          className
        )}
      >
        {frozen.map((segment, index) => renderSegment(segment, `f-${index}`))}
        {tailSegments.map((segment, index) => renderSegment(segment, `t-${index}`))}
      </div>
    )
  },
  (prev, next) => prev.content === next.content && prev.className === next.className
)

export default Markdown
