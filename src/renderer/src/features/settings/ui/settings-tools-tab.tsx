import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Search, Terminal, Globe, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { TOOL_CATALOG, toolIdsInCategory, type ToolCategoryId } from '@shared/tool-catalog'
import { patchPreferences, usePreferences } from '@/common/preferences'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const CATEGORY_ICONS: Record<ToolCategoryId, LucideIcon> = {
  files: FileText,
  search: Search,
  shell: Terminal,
  browser: Globe
}

export function SettingsToolsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const disabled = new Set(preferences.disabledTools)
  // Categories start collapsed; the user expands what they want to inspect.
  const [expanded, setExpanded] = useState<Set<ToolCategoryId>>(() => new Set())

  const setDisabled = (next: Set<string>): void => {
    void patchPreferences({ disabledTools: [...next] })
  }

  const toggleTool = (id: string, enabled: boolean): void => {
    const next = new Set(disabled)
    if (enabled) next.delete(id)
    else next.add(id)
    setDisabled(next)
  }

  const toggleCategory = (category: ToolCategoryId, enabled: boolean): void => {
    const next = new Set(disabled)
    for (const id of toolIdsInCategory(category)) {
      if (enabled) next.delete(id)
      else next.add(id)
    }
    setDisabled(next)
  }

  const toggleExpanded = (category: ToolCategoryId): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  return (
    <div className="prose-none flex flex-col gap-3">
      <p className="px-1 text-[0.6875rem] leading-4 text-foreground/45">
        {t('settings.tools.intro', {
          defaultValue:
            'Turn built-in tools on or off for the agent. Disabled tools are removed from every agent, including sub-agents.'
        })}
      </p>
      {TOOL_CATALOG.map((category) => {
        const Icon = CATEGORY_ICONS[category.id]
        const ids = category.tools.map((tool) => tool.id)
        const enabledCount = ids.filter((id) => !disabled.has(id)).length
        const allEnabled = enabledCount === ids.length
        const isOpen = expanded.has(category.id)
        return (
          <section
            key={category.id}
            className="not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/85 shadow-sm backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                onClick={() => toggleExpanded(category.id)}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 text-foreground/40 transition-transform duration-150',
                    isOpen && 'rotate-90'
                  )}
                />
                <span className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-muted/35 text-foreground/68 ring-1 ring-inset ring-border/15">
                  <Icon className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[0.8125rem] font-medium leading-tight tracking-[0.01em] text-foreground/90">
                    {t(`settings.tools.categories.${category.id}.title`, {
                      defaultValue: category.id
                    })}
                  </h2>
                  <p className="truncate text-[0.625rem] leading-4 tracking-[0.01em] text-foreground/45">
                    {t(`settings.tools.categories.${category.id}.description`, {
                      defaultValue: ''
                    })}
                  </p>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[0.625rem] tabular-nums text-foreground/45">
                  {t('settings.tools.enabledCount', {
                    defaultValue: '{{count}}/{{total}}',
                    count: enabledCount,
                    total: ids.length
                  })}
                </span>
                <Switch
                  checked={allEnabled}
                  onCheckedChange={(checked) => toggleCategory(category.id, checked)}
                  aria-label={t('settings.tools.toggleCategory', {
                    defaultValue: 'Toggle all tools in this category'
                  })}
                />
              </div>
            </div>
            {isOpen ? (
              <div className="divide-y divide-border/10 border-t border-border/10">
                {category.tools.map((tool) => {
                  const enabled = !disabled.has(tool.id)
                  return (
                    <div
                      key={tool.id}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-[0.75rem] text-foreground/82">
                            {tool.id}
                          </span>
                          {tool.readOnly ? (
                            <span className="shrink-0 rounded-md bg-emerald-500/[0.08] px-1.5 py-px text-[0.5625rem] font-medium text-emerald-600 dark:text-emerald-400">
                              {t('settings.tools.readOnly', { defaultValue: 'read-only' })}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-[0.625rem] leading-4 text-foreground/45">
                          {t(`settings.tools.descriptions.${tool.id}`, { defaultValue: '' })}
                        </p>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => toggleTool(tool.id, checked)}
                        aria-label={tool.id}
                      />
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
