import { AtSign, Download, MoreVertical, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  FeatureCard,
  CardHeader,
  CardDescription,
  CardDivider,
  CardFooter,
  CardStatusBadge
} from '@/components/ui/feature-card'
import type { MarketplacePluginEntry, PluginSummary } from '@shared/plugins'

/** Comma-free contribution summary, e.g. "Skills · 2 MCP · Hooks". */
function contributesParts(plugin: PluginSummary, t: TFunction): string[] {
  const parts: string[] = []
  if (plugin.contributes.skills) parts.push(t('plugins.contributes.skills'))
  if (plugin.contributes.mcpServers > 0) {
    parts.push(t('plugins.contributes.mcp', { count: plugin.contributes.mcpServers }))
  }
  if (plugin.contributes.hooks) parts.push(t('plugins.contributes.hooks'))
  return parts
}

export function InstalledPluginCard({
  plugin,
  onOpen,
  onToggle,
  onUninstall
}: {
  plugin: PluginSummary
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const name = plugin.displayName ?? plugin.pluginName
  const contributes = contributesParts(plugin, t)

  const actions = (
    <div className="flex items-center gap-1.5">
      <Switch
        checked={plugin.enabled}
        onCheckedChange={onToggle}
        aria-label={t('plugins.actions.toggle')}
        className="scale-75"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-[var(--radius-4xl)]" />
          }
        >
          <MoreVertical className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onClick={onUninstall}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-3.5" />
            {t('plugins.actions.uninstall')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <FeatureCard onClick={onOpen}>
      <div className="flex-1">
        <CardHeader
          title={name}
          badge={
            <Badge
              variant="outline"
              className="h-4 shrink-0 rounded-md px-1.5 text-[0.625rem] leading-none"
            >
              {plugin.marketplaceName}
            </Badge>
          }
          actions={actions}
        >
          <CardDescription>{plugin.description ?? t('plugins.card.noDescription')}</CardDescription>
        </CardHeader>
      </div>

      <CardDivider />

      <CardFooter>
        {plugin.error ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex cursor-help items-center gap-1 text-[0.6875rem] font-medium text-destructive" />
              }
            >
              {t('plugins.status.error')}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">{plugin.error}</p>
            </TooltipContent>
          </Tooltip>
        ) : plugin.enabled ? (
          <CardStatusBadge
            active
            activeIcon={<AtSign className="size-3 text-background" />}
            activeText={name}
          />
        ) : (
          <span className="text-[0.6875rem] font-medium text-muted-foreground">
            {t('common.status.disabled')}
          </span>
        )}
        {contributes.length > 0 ? (
          <span className="truncate text-[0.625rem] text-muted-foreground/70">
            {contributes.join(' · ')}
          </span>
        ) : null}
      </CardFooter>
    </FeatureCard>
  )
}

export function AvailablePluginCard({
  entry,
  installing,
  onInstall
}: {
  entry: MarketplacePluginEntry
  installing: boolean
  onInstall: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const name = entry.displayName ?? entry.pluginName

  return (
    <FeatureCard interactive={false}>
      <div className="flex-1">
        <CardHeader
          title={name}
          badge={
            entry.category ? (
              <Badge
                variant="outline"
                className="h-4 shrink-0 rounded-md px-1.5 text-[0.625rem] leading-none"
              >
                {entry.category}
              </Badge>
            ) : undefined
          }
        >
          <CardDescription>{entry.description ?? t('plugins.card.noDescription')}</CardDescription>
        </CardHeader>
      </div>

      <CardDivider />

      <CardFooter showArrow={false}>
        <span className="min-w-0 truncate text-[0.625rem] text-muted-foreground/70">
          {entry.marketplaceDisplayName ?? entry.marketplaceName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 gap-1.5 rounded-md px-2 text-[0.6875rem]"
          disabled={installing}
          onClick={onInstall}
        >
          {installing ? <Spinner className="size-3" /> : <Download className="size-3" />}
          {t('plugins.actions.install')}
        </Button>
      </CardFooter>
    </FeatureCard>
  )
}
