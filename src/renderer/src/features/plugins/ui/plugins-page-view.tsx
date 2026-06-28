import { Blocks, Download, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { pageHeaderIconBtnCls } from '@/components/layout/page-header'
import { ListPageScaffold } from '@/components/layout/page-scaffold'
import { cn } from '@/lib/utils'
import type { MarketplacePluginEntry, PluginSummary } from '@shared/plugins'
import type { usePluginsPageController } from '../model/use-plugins-page-controller'

type Controller = ReturnType<typeof usePluginsPageController>

export function PluginsPageView({ controller }: { controller: Controller }): React.ReactElement {
  const { t } = useTranslation()

  return (
    <>
      <ListPageScaffold
        title={t('plugins.page.title')}
        stats={controller.stats}
        searchValue={controller.searchValue}
        searchPlaceholder={t('plugins.page.search.placeholder')}
        onSearchChange={controller.setSearchValue}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(pageHeaderIconBtnCls, 'w-auto gap-1.5 px-2.5')}
            onClick={() => void controller.reload()}
          >
            <RefreshCw className={cn('size-3.5', controller.reloading && 'animate-spin')} />
            <span className="text-xs">{t('plugins.page.actions.reload')}</span>
          </Button>
        }
      >
        {controller.loading ? null : controller.filteredPlugins.length === 0 &&
          controller.filteredAvailable.length === 0 ? (
          <EmptyState
            icon={Blocks}
            title={t('plugins.page.empty.title')}
            description={t('plugins.page.empty.description')}
            searchQuery={controller.searchValue}
          />
        ) : (
          <div className="space-y-8 pt-4">
            {controller.filteredPlugins.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">
                  {t('plugins.page.sections.installed')}
                </h2>
                <div className="space-y-2">
                  {controller.filteredPlugins.map((plugin) => (
                    <InstalledRow
                      key={plugin.id}
                      plugin={plugin}
                      onToggle={(enabled) => void controller.togglePlugin(plugin, enabled)}
                      onUninstall={() => controller.setDeleteTarget(plugin)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {controller.filteredAvailable.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">
                  {t('plugins.page.sections.available')}
                </h2>
                <div className="space-y-2">
                  {controller.filteredAvailable.map((entry) => (
                    <AvailableRow
                      key={entry.id}
                      entry={entry}
                      installing={controller.installingId === entry.id}
                      onInstall={() => void controller.installPlugin(entry)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </ListPageScaffold>

      <AlertDialog
        open={controller.deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) controller.setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('plugins.uninstall.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('plugins.uninstall.description', {
                name: controller.deleteTarget?.displayName ?? controller.deleteTarget?.id ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void controller.confirmUninstall()}>
              {t('plugins.uninstall.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function InstalledRow({
  plugin,
  onToggle,
  onUninstall
}: {
  plugin: PluginSummary
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-lg bg-foreground/[0.025] px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5">
        <Blocks className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {plugin.displayName ?? plugin.pluginName}
          </span>
          <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[0.6875rem] leading-none">
            {plugin.marketplaceName}
          </Badge>
          {plugin.error ? (
            <Badge
              variant="destructive"
              className="h-5 rounded-md px-1.5 text-[0.6875rem] leading-none"
            >
              {t('plugins.status.error')}
            </Badge>
          ) : null}
        </div>
        {plugin.description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.description}</p>
        ) : null}
        <ContributesLine plugin={plugin} />
      </div>
      <Switch
        checked={plugin.enabled}
        onCheckedChange={onToggle}
        aria-label={t('plugins.actions.toggle')}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={onUninstall}
        aria-label={t('plugins.actions.uninstall')}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

function ContributesLine({ plugin }: { plugin: PluginSummary }): React.ReactElement | null {
  const { t } = useTranslation()
  const parts: string[] = []
  if (plugin.contributes.skills) parts.push(t('plugins.contributes.skills'))
  if (plugin.contributes.mcpServers > 0) {
    parts.push(t('plugins.contributes.mcp', { count: plugin.contributes.mcpServers }))
  }
  if (plugin.contributes.hooks) parts.push(t('plugins.contributes.hooks'))
  if (parts.length === 0) return null
  return <p className="mt-1 text-[0.6875rem] text-muted-foreground/70">{parts.join(' · ')}</p>
}

function AvailableRow({
  entry,
  installing,
  onInstall
}: {
  entry: MarketplacePluginEntry
  installing: boolean
  onInstall: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-lg bg-foreground/[0.025] px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5">
        <Blocks className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {entry.displayName ?? entry.pluginName}
          </span>
          {entry.category ? (
            <Badge
              variant="outline"
              className="h-5 rounded-md px-1.5 text-[0.6875rem] leading-none"
            >
              {entry.category}
            </Badge>
          ) : null}
        </div>
        {entry.description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.description}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(pageHeaderIconBtnCls, 'w-auto gap-1.5 px-2.5')}
        disabled={installing}
        onClick={onInstall}
      >
        {installing ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
        <span className="text-xs">{t('plugins.actions.install')}</span>
      </Button>
    </div>
  )
}
