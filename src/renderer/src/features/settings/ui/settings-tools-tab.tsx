import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  Search,
  Terminal,
  Globe,
  ChevronRight,
  Bot,
  GitBranch,
  Lock,
  Server,
  Sparkles
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  TOOL_CATALOG,
  BROWSER_TOOLS,
  toggleableToolIdsInCategory,
  mcpToolId,
  type ToolCategoryId
} from '@shared/tool-catalog'
import { BUILTIN_BROWSER_SERVER_NAME } from '@shared/mcp'
import type { McpServerConfig } from '@/common/contracts'
import { patchPreferences, usePreferences } from '@/common/preferences'
import { useServers, useServerConnectionState, useServerTools } from '@/features/mcp/model'
import { serverKeys, mcpClientKeys } from '@/features/mcp/model/query-keys'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const CATEGORY_ICONS: Record<ToolCategoryId, LucideIcon> = {
  files: FileText,
  search: Search,
  shell: Terminal,
  agent: Sparkles,
  subagents: GitBranch,
  core: Bot,

  browser: Globe
}

const SECTION_CLASS =
  'not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/85 shadow-sm backdrop-blur-sm'

const ICON_BADGE_CLASS =
  'flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-muted/35 text-foreground/68 ring-1 ring-inset ring-border/15'

interface ToolRowProps {
  id: string
  label?: string
  description?: string
  readOnly?: boolean
  locked?: boolean

  switchDisabled?: boolean
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

function ToolRow({
  id,
  label,
  description,
  readOnly,
  locked,
  switchDisabled,
  enabled,
  onToggle
}: ToolRowProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[length:var(--code-font-size-lg)] text-foreground/82">
            {label ?? id}
          </span>
          {readOnly ? (
            <span className="shrink-0 rounded-md bg-emerald-500/[0.08] px-1.5 py-px text-[0.5625rem] font-medium text-emerald-600 dark:text-emerald-400">
              {t('settings.tools.readOnly', { defaultValue: 'read-only' })}
            </span>
          ) : null}
          {locked ? (
            <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/40 px-1.5 py-px text-[0.5625rem] font-medium text-foreground/55">
              <Lock className="size-2.5" />
              {t('settings.tools.locked', { defaultValue: 'required' })}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="truncate text-[0.625rem] leading-4 text-foreground/45">{description}</p>
        ) : null}
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        disabled={locked || switchDisabled}
        aria-label={label ?? id}
      />
    </div>
  )
}

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  description: string
  isOpen: boolean
  onToggleOpen: () => void
  enabledCount: number
  totalCount: number
  switchChecked: boolean
  onSwitchChange: (checked: boolean) => void
  switchDisabled?: boolean
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  isOpen,
  onToggleOpen,
  enabledCount,
  totalCount,
  switchChecked,
  onSwitchChange,
  switchDisabled
}: SectionHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-2.5 py-2">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-foreground/40 transition-transform duration-150',
            isOpen && 'rotate-90'
          )}
        />
        <span className={ICON_BADGE_CLASS}>
          <Icon className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.8125rem] font-medium leading-tight tracking-[0.01em] text-foreground/90">
            {title}
          </h2>
          <p className="truncate text-[0.625rem] leading-4 tracking-[0.01em] text-foreground/45">
            {description}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[0.625rem] tabular-nums text-foreground/45">
          {t('settings.tools.enabledCount', {
            defaultValue: '{{count}}/{{total}}',
            count: enabledCount,
            total: totalCount
          })}
        </span>
        <Switch
          checked={switchChecked}
          onCheckedChange={onSwitchChange}
          disabled={switchDisabled}
          aria-label={t('settings.tools.toggleCategory', {
            defaultValue: 'Toggle all tools in this category'
          })}
        />
      </div>
    </div>
  )
}

function BrowserAutomationSection(): React.JSX.Element {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const enabled = preferences.browserAutomation
  const disabled = new Set(preferences.disabledTools)

  const { data: servers } = useServers()
  const builtinBrowserServer = (servers ?? []).find((server) => server.builtin === true)
  const { state } = useServerConnectionState(builtinBrowserServer?.name ?? '')
  const connected = builtinBrowserServer != null && state?.status === 'connected'
  const { data: toolsData } = useServerTools(builtinBrowserServer?.name ?? '', connected)
  const mcpTools = connected ? (toolsData?.tools ?? []) : []

  const builtinIds = BROWSER_TOOLS.map((tool) => tool.id)
  const mcpIds = mcpTools.map((tool) => mcpToolId(BUILTIN_BROWSER_SERVER_NAME, tool.name))
  const allIds = [...builtinIds, ...mcpIds]
  const enabledCount = enabled ? allIds.filter((id) => !disabled.has(id)).length : 0

  const setDisabled = (next: Set<string>): void => {
    void patchPreferences({ disabledTools: [...next] })
  }

  const toggleOne = (id: string, on: boolean): void => {
    const next = new Set(disabled)
    if (on) next.delete(id)
    else next.add(id)
    setDisabled(next)
  }

  const setEnabled = async (next: boolean): Promise<void> => {
    await patchPreferences({ browserAutomation: next })

    void queryClient.invalidateQueries({ queryKey: serverKeys.lists() })
    void queryClient.invalidateQueries({ queryKey: mcpClientKeys.connectionStates() })
  }

  return (
    <section className={SECTION_CLASS}>
      <SectionHeader
        icon={Globe}
        title={t('settings.tools.browserAutomation.title', { defaultValue: 'Browser automation' })}
        description={t('settings.tools.browserAutomation.description', {
          defaultValue:
            'Let the agent drive the built-in browser: open pages, read, fill forms, click, screenshot.'
        })}
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen((prev) => !prev)}
        enabledCount={enabledCount}
        totalCount={allIds.length}
        switchChecked={enabled}
        onSwitchChange={(checked) => void setEnabled(checked)}
      />
      {isOpen ? (
        <div className="divide-y divide-border/10 border-t border-border/10">
          {BROWSER_TOOLS.map((tool) => (
            <ToolRow
              key={tool.id}
              id={tool.id}
              description={t(`settings.tools.descriptions.${tool.id}`, { defaultValue: '' })}
              readOnly={tool.readOnly}
              switchDisabled={!enabled}
              enabled={enabled && !disabled.has(tool.id)}
              onToggle={(on) => toggleOne(tool.id, on)}
            />
          ))}
          {mcpTools.map((tool) => {
            const id = mcpToolId(BUILTIN_BROWSER_SERVER_NAME, tool.name)
            return (
              <ToolRow
                key={id}
                id={id}
                label={tool.name}
                {...(tool.description ? { description: tool.description } : {})}
                readOnly={tool.annotations?.readOnlyHint === true}
                switchDisabled={!enabled}
                enabled={enabled && !disabled.has(id)}
                onToggle={(on) => toggleOne(id, on)}
              />
            )
          })}
          {enabled && !connected ? (
            <p className="px-3 py-1.5 text-[0.625rem] leading-4 text-foreground/45">
              {t('settings.tools.browserAutomation.connecting', {
                defaultValue:
                  'Browser driver tools appear here once the chrome-devtools server connects.'
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {!enabled ? (
        <p className="border-t border-border/10 px-3 py-1.5 text-[0.625rem] leading-4 text-foreground/45">
          {t('settings.tools.browserAutomation.restartNote', {
            defaultValue:
              'Agent access is off. The browser debugging port closes fully after restarting Tanzo.'
          })}
        </p>
      ) : null}
    </section>
  )
}

function McpServerSection({
  server,
  disabled,
  onPatch
}: {
  server: McpServerConfig
  disabled: Set<string>
  onPatch: (next: Set<string>) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { state } = useServerConnectionState(server.name)
  const connected = state?.status === 'connected'
  const { data } = useServerTools(server.name, connected)
  const tools = data?.tools ?? []

  if (!connected || tools.length === 0) return null

  const ids = tools.map((tool) => mcpToolId(server.name, tool.name))
  const enabledCount = ids.filter((id) => !disabled.has(id)).length
  const allEnabled = enabledCount === ids.length

  const toggleAll = (enabled: boolean): void => {
    const next = new Set(disabled)
    for (const id of ids) {
      if (enabled) next.delete(id)
      else next.add(id)
    }
    onPatch(next)
  }

  const toggleOne = (id: string, enabled: boolean): void => {
    const next = new Set(disabled)
    if (enabled) next.delete(id)
    else next.add(id)
    onPatch(next)
  }

  return (
    <section className={SECTION_CLASS}>
      <SectionHeader
        icon={Server}
        title={server.name}
        description={
          server.description ||
          t('settings.tools.mcp.serverDescription', { defaultValue: 'MCP server tools' })
        }
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen((prev) => !prev)}
        enabledCount={enabledCount}
        totalCount={ids.length}
        switchChecked={allEnabled}
        onSwitchChange={toggleAll}
      />
      {isOpen ? (
        <div className="divide-y divide-border/10 border-t border-border/10">
          {tools.map((tool) => {
            const id = mcpToolId(server.name, tool.name)
            return (
              <ToolRow
                key={id}
                id={id}
                label={tool.name}
                {...(tool.description ? { description: tool.description } : {})}
                readOnly={tool.annotations?.readOnlyHint === true}
                enabled={!disabled.has(id)}
                onToggle={(enabled) => toggleOne(id, enabled)}
              />
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function McpToolsSections(): React.JSX.Element | null {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const disabled = new Set(preferences.disabledTools)
  const { data: servers } = useServers()

  const setDisabled = (next: Set<string>): void => {
    void patchPreferences({ disabledTools: [...next] })
  }

  const enabledServers = (servers ?? []).filter(
    (server) => server.enabled && server.builtin !== true
  )
  if (enabledServers.length === 0) return null

  return (
    <>
      <p className="mt-2 px-1 text-[0.6875rem] leading-4 text-foreground/45">
        {t('settings.tools.mcp.intro', {
          defaultValue:
            'Tools from connected MCP servers. Disabling a tool hides it from the agent; manage whole servers in MCP settings.'
        })}
      </p>
      {enabledServers.map((server) => (
        <McpServerSection
          key={server.id ?? server.name}
          server={server}
          disabled={disabled}
          onPatch={setDisabled}
        />
      ))}
    </>
  )
}

export function SettingsToolsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const disabled = new Set(preferences.disabledTools)

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
    for (const id of toggleableToolIdsInCategory(category)) {
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
        const toggleableIds = category.tools.filter((tool) => !tool.locked).map((tool) => tool.id)
        const enabledCount = category.tools.filter(
          (tool) => tool.locked || !disabled.has(tool.id)
        ).length
        const allEnabled = toggleableIds.every((id) => !disabled.has(id))
        const isOpen = expanded.has(category.id)
        return (
          <section key={category.id} className={SECTION_CLASS}>
            <SectionHeader
              icon={CATEGORY_ICONS[category.id]}
              title={t(`settings.tools.categories.${category.id}.title`, {
                defaultValue: category.id
              })}
              description={t(`settings.tools.categories.${category.id}.description`, {
                defaultValue: ''
              })}
              isOpen={isOpen}
              onToggleOpen={() => toggleExpanded(category.id)}
              enabledCount={enabledCount}
              totalCount={category.tools.length}
              switchChecked={allEnabled}
              onSwitchChange={(checked) => toggleCategory(category.id, checked)}
              switchDisabled={toggleableIds.length === 0}
            />
            {isOpen ? (
              <div className="divide-y divide-border/10 border-t border-border/10">
                {category.tools.map((tool) => (
                  <ToolRow
                    key={tool.id}
                    id={tool.id}
                    description={t(`settings.tools.descriptions.${tool.id}`, { defaultValue: '' })}
                    readOnly={tool.readOnly}
                    locked={tool.locked === true}
                    enabled={tool.locked === true || !disabled.has(tool.id)}
                    onToggle={(enabled) => toggleTool(tool.id, enabled)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        )
      })}
      <BrowserAutomationSection />
      <McpToolsSections />
    </div>
  )
}
