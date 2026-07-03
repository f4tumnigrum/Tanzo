import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Bot, FileText, Sparkles, Terminal, type LucideIcon } from 'lucide-react'
import type { SlashCommandDef, SlashCommandSource } from '@shared/slash-command'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/ui/liquid-glass'
import { orderSlashCommands, SOURCE_ORDER } from './slash-command-order'

interface SlashCommandMenuProps {
  commands: SlashCommandDef[]
  highlightedIndex: number
  onHighlight: (index: number) => void
  onSelect: (command: SlashCommandDef) => void
  className?: string
}

const SOURCE_ICON: Record<SlashCommandSource, LucideIcon> = {
  builtin: Archive,
  agent: Bot,
  command: FileText,
  skill: Sparkles
}

const BUILTIN_ICON: Record<string, LucideIcon> = {
  compact: Archive
}

export function SlashCommandMenu({
  commands,
  highlightedIndex,
  onHighlight,
  onSelect,
  className
}: SlashCommandMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(
    () =>
      SOURCE_ORDER.map((source) => ({
        source,
        items: commands.filter((command) => command.source === source)
      })).filter((group) => group.items.length > 0),
    [commands]
  )

  const flat = useMemo(() => orderSlashCommands(commands), [commands])

  useEffect(() => {
    const active = flat[highlightedIndex]
    if (!active || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd="${active.name}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [flat, highlightedIndex])

  if (commands.length === 0) {
    return (
      <LiquidGlass
        aberration
        className={cn(
          'pointer-events-auto w-[min(440px,calc(100vw-2rem))] rounded-[calc(var(--radius)+8px)] p-3 shadow-none!',
          className
        )}
      >
        <p className="text-[0.625rem] text-muted-foreground/60">
          {t('chat.composer.slashCommands.empty')}
        </p>
      </LiquidGlass>
    )
  }

  return (
    <LiquidGlass
      aberration
      className={cn(
        'pointer-events-auto w-[min(440px,calc(100vw-2rem))] overflow-hidden rounded-[calc(var(--radius)+8px)] shadow-none!',
        className
      )}
    >
      <div ref={listRef} className="max-h-[208px] overflow-y-auto p-1.5">
        {groups.map((group) => {
          const GroupIcon = SOURCE_ICON[group.source]
          return (
            <div key={group.source} className="px-0.5">
              <div className="px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground/60">
                {t(`chat.composer.slashCommands.groups.${group.source}`)}
              </div>
              {group.items.map((command) => {
                const flatIndex = flat.indexOf(command)
                const selected = flatIndex === highlightedIndex
                const Icon =
                  command.source === 'builtin'
                    ? (BUILTIN_ICON[command.name] ?? GroupIcon)
                    : command.source === 'agent'
                      ? Bot
                      : command.source === 'skill'
                        ? Sparkles
                        : command.source === 'command'
                          ? Terminal
                          : GroupIcon
                const label = command.descriptionKey
                  ? t(command.descriptionKey)
                  : (command.description ?? command.name)
                return (
                  <button
                    key={`${command.source}:${command.name}`}
                    type="button"
                    data-cmd={command.name}
                    onMouseEnter={() => onHighlight(flatIndex)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      onSelect(command)
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
                    <span className="truncate">{label}</span>
                    <span className="ml-auto shrink-0 text-[0.5625rem] font-medium text-muted-foreground/50">
                      {command.insertText
                        ? command.insertText.trim()
                        : `/${command.name}${command.argsHint ? ` ${command.argsHint}` : ''}`}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </LiquidGlass>
  )
}
