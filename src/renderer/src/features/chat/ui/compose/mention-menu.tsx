import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Blocks, File, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/ui/liquid-glass'
import { mentionItemId, type MentionItem } from './use-mention-menu'

interface MentionMenuProps {
  items: MentionItem[]
  highlightedIndex: number
  onHighlight: (index: number) => void
  onSelect: (item: MentionItem) => void
  className?: string
}

type MentionKind = MentionItem['kind']

// Render order of the groups; matches the flat ordering produced by the hook
// (plugins first, then files), so flat-index navigation stays consistent.
const KIND_ORDER: readonly MentionKind[] = ['plugin', 'file']

function MentionRow({
  item,
  selected,
  onHighlight,
  onSelect
}: {
  item: MentionItem
  selected: boolean
  onHighlight: () => void
  onSelect: () => void
}): React.JSX.Element {
  const isPlugin = item.kind === 'plugin'
  const Icon = isPlugin ? Blocks : item.type === 'directory' ? Folder : File
  const meta = isPlugin
    ? item.description
    : item.path.slice(0, item.path.length - item.name.length).replace(/\/$/, '')

  return (
    <button
      type="button"
      data-mention={mentionItemId(item)}
      onMouseEnter={onHighlight}
      onMouseDown={(event) => {
        event.preventDefault()
        onSelect()
      }}
      className={cn(
        'flex h-6 w-full items-center gap-2 rounded-[calc(var(--radius)-2px)] px-2 text-[0.6875rem] font-medium',
        selected ? 'bg-foreground/[0.08] text-foreground' : 'text-foreground/85'
      )}
    >
      <Icon
        className={cn(
          'size-3 shrink-0',
          selected ? 'text-foreground/90' : 'text-muted-foreground/60'
        )}
        strokeWidth={1.8}
      />
      <span className="truncate">{item.name}</span>
      {meta ? (
        <span className="ml-auto shrink-0 truncate text-[0.5625rem] font-medium text-muted-foreground/50">
          {meta}
        </span>
      ) : null}
    </button>
  )
}

export function MentionMenu({
  items,
  highlightedIndex,
  onHighlight,
  onSelect,
  className
}: MentionMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)

  // Group by kind for display while keeping each item's flat index for
  // keyboard navigation and highlight tracking (mirrors the slash menu).
  const groups = useMemo(() => {
    const byKind = new Map<MentionKind, { item: MentionItem; index: number }[]>()
    items.forEach((item, index) => {
      const rows = byKind.get(item.kind)
      if (rows) rows.push({ item, index })
      else byKind.set(item.kind, [{ item, index }])
    })
    return KIND_ORDER.flatMap((kind) => {
      const rows = byKind.get(kind)
      return rows ? [{ kind, rows }] : []
    })
  }, [items])

  useEffect(() => {
    const active = items[highlightedIndex]
    if (!active || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-mention="${mentionItemId(active)}"]`
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [items, highlightedIndex])

  if (items.length === 0) return null

  return (
    <LiquidGlass
      aberration
      className={cn(
        'pointer-events-auto w-[min(440px,calc(100vw-2rem))] overflow-hidden rounded-[calc(var(--radius)+8px)] shadow-none!',
        className
      )}
    >
      <div ref={listRef} className="max-h-[208px] overflow-y-auto p-1.5">
        {groups.map((group) => (
          <div key={group.kind} className="px-0.5">
            <div className="px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground/60">
              {t(`chat.composer.mentions.groups.${group.kind}`)}
            </div>
            {group.rows.map(({ item, index }) => (
              <MentionRow
                key={mentionItemId(item)}
                item={item}
                selected={index === highlightedIndex}
                onHighlight={() => onHighlight(index)}
                onSelect={() => onSelect(item)}
              />
            ))}
          </div>
        ))}
      </div>
    </LiquidGlass>
  )
}
