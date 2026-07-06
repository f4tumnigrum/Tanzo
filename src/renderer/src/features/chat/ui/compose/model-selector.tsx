import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Brain, ChevronRight, Cloud, Plug, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ProviderId } from '@/common/contracts'
import {
  findModelOption,
  type LanguageModelOption,
  useAvailableLanguageModels
} from '../../model/use-available-models'

const PROVIDER_ICON: Record<string, typeof Cloud> = {
  openai: Bot,
  'openai-chat': Bot,
  google: Bot,
  anthropic: Brain,
  deepseek: Sparkles,
  zhipu: Sparkles,
  minimax: Sparkles,
  'openai-compatible': Plug
}

const PROVIDER_DISPLAY_NAME: Partial<Record<ProviderId, string>> = {
  openai: 'OpenAI',
  'openai-chat': 'OpenAI Chat',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  'openai-compatible': 'OpenAI-compatible'
}

export interface ModelSelectorProps {
  selectedId: string | null
  onSelect: (modelId: string) => void
  /** Current reasoning effort shown on the badge (a cycle member). */
  reasoningEffort: string
  /** Cycle options (schema-driven); null hides the badge. */
  reasoningEffortOptions: string[] | null
  onReasoningEffortChange: (effort: string) => void
  subagent?: {
    selectedId: string | null
    onSelect: (modelId: string) => void
  }
  disabled?: boolean
  className?: string
}

type ModelSelectorTab = 'agent' | 'subagent'

export function ModelSelector({
  selectedId,
  onSelect,
  reasoningEffort,
  reasoningEffortOptions,
  onReasoningEffortChange,
  subagent,
  disabled,
  className
}: ModelSelectorProps): React.JSX.Element {
  const { t } = useTranslation()
  const contentId = useId()
  const { models, byProvider, isLoading, isEmpty } = useAvailableLanguageModels()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ModelSelectorTab>('agent')

  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null)
  const [query, setQuery] = useState('')

  const selected = useMemo(() => findModelOption(models, selectedId), [models, selectedId])

  const paneSelectedId = tab === 'subagent' ? (subagent?.selectedId ?? null) : selectedId
  const paneOnSelect = tab === 'subagent' && subagent ? subagent.onSelect : onSelect
  const paneSelected = useMemo(
    () => findModelOption(models, paneSelectedId),
    [models, paneSelectedId]
  )

  const effectiveProvider =
    activeProvider ?? paneSelected?.providerId ?? byProvider[0]?.providerId ?? null

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (!next) {
      setQuery('')
      setActiveProvider(null)
      setTab('agent')
    }
  }

  const currentRail = useMemo(
    () => byProvider.find((g) => g.providerId === effectiveProvider) ?? null,
    [byProvider, effectiveProvider]
  )

  const visibleModels = useMemo(() => {
    if (!currentRail) return []
    if (!query) return currentRail.models
    const q = query.toLowerCase()
    return currentRail.models.filter(
      (m) => m.modelKey.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    )
  }, [currentRail, query])

  const efforts = reasoningEffortOptions

  const cycleEffort = (): void => {
    if (!efforts || efforts.length <= 1) return
    const idx = efforts.indexOf(reasoningEffort)
    const nextIdx = idx === -1 ? 0 : (idx + 1) % efforts.length
    const next = efforts[nextIdx]
    if (next) onReasoningEffortChange(next)
  }

  const triggerLabel = selected
    ? selected.modelKey
    : isLoading
      ? t('chat.composer.modelSelector.loading')
      : isEmpty
        ? t('chat.composer.modelSelector.empty')
        : t('chat.composer.modelSelector.pick')

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <PopoverTrigger
          render={(triggerProps) => (
            <TooltipTrigger
              render={(tooltipProps) => (
                <Button
                  {...tooltipProps}
                  {...triggerProps}
                  type="button"
                  role="combobox"
                  aria-controls={contentId}
                  aria-expanded={open}
                  aria-haspopup="listbox"
                  aria-label={selected ? selected.name : triggerLabel}
                  disabled={disabled || (isEmpty && !isLoading)}
                  variant="ghost"
                  size="xs"
                  className={cn(
                    'h-6 items-center gap-1 rounded-[var(--radius-4xl)] px-2',
                    'text-[0.65625rem] font-medium text-muted-foreground/70',
                    'transition-all duration-150 select-none',
                    'hover:bg-transparent hover:text-foreground active:scale-[0.98] dark:hover:bg-transparent',
                    'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:outline-none',
                    'disabled:pointer-events-none disabled:opacity-50',
                    open && 'bg-transparent text-foreground',
                    className
                  )}
                >
                  <span className="max-w-[132px] truncate sm:max-w-[160px]">{triggerLabel}</span>
                  {efforts ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        cycleEffort()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          cycleEffort()
                        }
                      }}
                      className="ml-0.5 shrink-0 cursor-pointer rounded-[var(--radius-4xl)] bg-primary/10 px-1 py-px text-[0.5625rem] font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      {t(`chat.composer.reasoningEffort.${reasoningEffort}`, {
                        defaultValue: reasoningEffort
                      })}
                    </span>
                  ) : null}
                </Button>
              )}
            />
          )}
        />
        <TooltipContent side="top">{selected ? selected.name : triggerLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent
        id={contentId}
        align="end"
        sideOffset={8}
        className="w-[340px] gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-[color-mix(in_oklab,var(--border)_46%,transparent)] bg-popover/95 p-0 text-popover-foreground shadow-lg backdrop-blur-md"
      >
        {isLoading ? (
          <p className="px-3 py-2.5 text-[0.6875rem] text-muted-foreground">
            {t('chat.composer.modelSelector.loading')}
          </p>
        ) : isEmpty ? (
          <p className="px-3 py-2.5 text-[0.6875rem] text-muted-foreground">
            {t('chat.composer.modelSelector.emptyHint')}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5 border-b border-border/15 px-1.5 py-1.5">
              {subagent ? (
                <div className="inline-flex shrink-0 items-center rounded-[var(--radius-lg)] bg-muted/50 p-0.5">
                  <TabButton
                    active={tab === 'agent'}
                    label={t('chat.composer.modelSelector.tabAgent')}
                    onClick={() => {
                      setTab('agent')
                      setActiveProvider(null)
                      setQuery('')
                    }}
                  />
                  <TabButton
                    active={tab === 'subagent'}
                    label={t('chat.composer.modelSelector.tabSubagent')}
                    onClick={() => {
                      setTab('subagent')
                      setActiveProvider(null)
                      setQuery('')
                    }}
                  />
                </div>
              ) : null}
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground/40" />
                <Input
                  variant="bare"
                  placeholder={t('chat.composer.modelSelector.searchPlaceholder')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={!currentRail}
                  className="h-5 pr-2 pl-7 text-[0.6875rem] placeholder:text-muted-foreground/40 disabled:opacity-50"
                />
              </div>
            </div>
            <div className="flex h-[222px]">
              <ProviderRail
                groups={byProvider}
                activeProvider={activeProvider}
                onPick={(id) => {
                  setActiveProvider(id)
                  setQuery('')
                }}
              />
              <ModelPane
                models={visibleModels}
                selectedId={paneSelectedId}
                hasProvider={Boolean(currentRail)}
                onPick={(m) => {
                  paneOnSelect(m.id)
                  setOpen(false)
                  setActiveProvider(null)
                  setQuery('')
                  setTab('agent')
                }}
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ProviderRailProps {
  groups: ReturnType<typeof useAvailableLanguageModels>['byProvider']
  activeProvider: ProviderId | null
  onPick: (id: ProviderId) => void
}

function ProviderRail({ groups, activeProvider, onPick }: ProviderRailProps): React.JSX.Element {
  return (
    <div className="flex w-[110px] shrink-0 flex-col border-r border-border/15 bg-muted/10">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-1">
          {groups.map(({ providerId }) => {
            const Icon = PROVIDER_ICON[providerId.toLowerCase()] ?? Cloud
            const isActive = activeProvider === providerId
            return (
              <Button
                key={providerId}
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onPick(providerId)}
                className={cn(
                  'group h-[1.375rem] w-full justify-between rounded-[var(--radius-md)] px-1.5',
                  'text-[0.625rem] font-medium leading-none transition-colors duration-150',
                  isActive
                    ? 'bg-foreground/[0.07] text-foreground'
                    : 'text-muted-foreground/70 hover:bg-transparent hover:text-foreground/90 dark:hover:bg-transparent'
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Icon
                    className={cn(
                      'h-3 w-3 shrink-0 transition-colors',
                      isActive
                        ? 'text-foreground'
                        : 'text-muted-foreground/60 group-hover:text-foreground/80'
                    )}
                  />
                  <span className="truncate">
                    {PROVIDER_DISPLAY_NAME[providerId] ?? providerId}
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    'h-3 w-3 shrink-0 transition-all',
                    isActive ? 'text-foreground/60 opacity-100' : 'opacity-0 group-hover:opacity-40'
                  )}
                />
              </Button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

interface ModelPaneProps {
  models: LanguageModelOption[]
  selectedId: string | null
  hasProvider: boolean
  onPick: (m: LanguageModelOption) => void
}

function ModelPane({ models, selectedId, hasProvider, onPick }: ModelPaneProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        {!hasProvider ? (
          <EmptyState message={t('chat.composer.modelSelector.selectProvider')} />
        ) : models.length === 0 ? (
          <EmptyState message={t('chat.composer.modelSelector.noMatches')} />
        ) : (
          <div className="flex flex-col gap-0.5 p-1">
            {models.map((m) => {
              const isSelected = m.id === selectedId
              return (
                <Tooltip key={m.id}>
                  <TooltipTrigger
                    render={(triggerProps) => (
                      <Button
                        {...triggerProps}
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => onPick(m)}
                        className={cn(
                          'group h-[1.375rem] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-1.5 text-left',
                          'text-[0.625rem] font-medium leading-none transition-colors duration-150',
                          isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground/70 hover:bg-transparent hover:text-foreground/90 dark:hover:bg-transparent'
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{m.modelKey}</span>
                        {m.isDefault ? (
                          <span className="shrink-0 rounded-[var(--radius-4xl)] bg-primary/15 px-1.5 py-px text-[0.5rem] font-semibold text-primary uppercase">
                            default
                          </span>
                        ) : null}
                      </Button>
                    )}
                  />
                  <TooltipContent side="top">{m.modelKey}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function TabButton({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative h-5 rounded-[var(--radius-md)] px-2.5 text-[0.625rem] font-medium leading-none',
        'transition-colors duration-150 outline-none',
        'focus-visible:ring-1 focus-visible:ring-ring/60',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground/65 hover:text-foreground/85'
      )}
    >
      {label}
    </button>
  )
}

function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center p-4 text-center">
      <Cloud className="mb-2 h-4 w-4 text-muted-foreground/20" />
      <p className="text-[0.625rem] text-muted-foreground/50">{message}</p>
    </div>
  )
}
