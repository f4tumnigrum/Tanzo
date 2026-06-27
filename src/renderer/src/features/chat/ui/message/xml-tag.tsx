import { memo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { usePreferences } from '@/common/preferences'
import { cn } from '@/lib/utils'
import { useChatUiStore } from '../../model/store'
import { Markdown } from './markdown'

export interface XmlTagProps {
  tag: string
  children: ReactNode

  defaultExpanded?: boolean
  disclosureKey?: string
}

const TAG_LABEL_KEYS: Record<string, string> = {
  thinking: 'chat.message.xmlTag.reasoning',
  reasoning: 'chat.message.xmlTag.reasoning',
  toolplan: 'chat.message.xmlTag.planning',
  observation: 'chat.message.xmlTag.observation',
  reflection: 'chat.message.xmlTag.reflection',
  response: 'chat.message.xmlTag.response'
}

function usesReasoningPreference(tag: string): boolean {
  return tag === 'thinking' || tag === 'reasoning'
}

function toMarkdownContent(node: ReactNode): string | null {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    const parts = node.map(toMarkdownContent)
    return parts.every((p) => p !== null) ? parts.join('') : null
  }
  return null
}

export const XmlTag = memo(function XmlTag({
  tag,
  children,
  defaultExpanded,
  disclosureKey
}: XmlTagProps): React.JSX.Element {
  const { t } = useTranslation()
  const normalized = tag.toLowerCase().replace(/[_-]/g, '')
  const labelKey = TAG_LABEL_KEYS[normalized]
  const label = labelKey ? t(labelKey) : tag
  const reasoningExpandedByDefault = usePreferences().reasoningExpandedByDefault
  const initial =
    defaultExpanded ?? (usesReasoningPreference(normalized) ? reasoningExpandedByDefault : true)

  const storedExpanded = useChatUiStore((state) =>
    disclosureKey ? state.disclosureById[disclosureKey] : undefined
  )
  const setDisclosure = useChatUiStore((state) => state.setDisclosure)
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null)
  const expanded = disclosureKey ? (storedExpanded ?? initial) : (localExpanded ?? initial)
  const toggle = (): void => {
    if (disclosureKey) setDisclosure(disclosureKey, !expanded)
    else setLocalExpanded((prev) => !(prev ?? initial))
  }

  const markdownContent = toMarkdownContent(children)

  return (
    <div className="my-2 first:mt-0 last:mb-0">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex w-full items-center gap-1.5 px-0 py-0.5 text-[0.8125em] font-medium text-foreground/72',
          'transition-colors duration-150 hover:text-foreground'
        )}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-foreground/55 transition-transform duration-200 ease-out',
            expanded && 'rotate-90'
          )}
        />
        <span className="truncate tracking-[0.01em]">{label}</span>
      </button>

      {expanded && (
        <div
          className={cn(
            'relative mt-2 ml-4 pl-3 text-[0.8125em] leading-[1.76] text-foreground/80',
            'before:pointer-events-none before:absolute before:left-0 before:top-0.5 before:bottom-0.5 before:w-px',
            'before:bg-gradient-to-b before:from-transparent before:via-border/80 before:to-transparent'
          )}
        >
          {markdownContent !== null ? (
            <Markdown
              content={markdownContent}
              className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            />
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
})
