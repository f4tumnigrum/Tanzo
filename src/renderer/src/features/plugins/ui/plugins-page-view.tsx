import { Blocks, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
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
import type { usePluginsPageController } from '../model/use-plugins-page-controller'
import { AvailablePluginsGrid, InstalledPluginsGrid } from './plugins-grid'
import { PluginDetailView } from './plugin-detail-view'

type Controller = ReturnType<typeof usePluginsPageController>

export function PluginsPageView({ controller }: { controller: Controller }): React.ReactElement {
  const { t } = useTranslation()

  if (controller.selectedPlugin) {
    return (
      <PluginDetailView
        plugin={controller.selectedPlugin}
        detail={controller.detail}
        onBack={() => controller.setSelectedPluginId(null)}
        onToggle={(enabled) => void controller.togglePlugin(controller.selectedPlugin!, enabled)}
        onUninstall={() => controller.setDeleteTarget(controller.selectedPlugin!)}
      />
    )
  }

  const noResults =
    controller.filteredPlugins.length === 0 && controller.filteredAvailable.length === 0

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
        {controller.loading ? null : noResults ? (
          <EmptyState
            icon={Blocks}
            title={t('plugins.page.empty.title')}
            description={t('plugins.page.empty.description')}
            searchQuery={controller.searchValue}
          />
        ) : (
          <div className="space-y-8">
            <InstalledPluginsGrid
              title={t('plugins.page.sections.installed')}
              plugins={controller.filteredPlugins}
              onOpen={(plugin) => controller.setSelectedPluginId(plugin.id)}
              onToggle={(plugin, enabled) => void controller.togglePlugin(plugin, enabled)}
              onUninstall={(plugin) => controller.setDeleteTarget(plugin)}
            />
            <AvailablePluginsGrid
              title={t('plugins.page.sections.available')}
              entries={controller.filteredAvailable}
              installingId={controller.installingId}
              onInstall={(entry) => void controller.installPlugin(entry)}
            />
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
