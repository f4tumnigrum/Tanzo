import { Plus, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListPageScaffold } from '@/components/layout/page-scaffold'
import type { useMcpPageController } from '../model/use-mcp-page-controller'
import { ServerDetailView } from './client/server-detail-view'
import { ServerEditorDialog } from './client/server-editor-dialog'
import { ServersGrid } from './client/servers-grid'

type McpPageController = ReturnType<typeof useMcpPageController>

export function McpPageView({ controller }: { controller: McpPageController }) {
  const { t } = useTranslation()

  if (controller.selectedServer) {
    return <ServerDetailView server={controller.selectedServer} />
  }

  return (
    <ListPageScaffold
      title={t('mcp.page.title')}
      stats={[
        { value: controller.resolvedServers.length, label: t('common.metrics.total') },
        ...(controller.enabledCount > 0
          ? [{ value: controller.enabledCount, label: t('common.status.enabled') }]
          : [])
      ]}
      searchValue={controller.searchQuery}
      onSearchChange={controller.setSearchQuery}
      searchPlaceholder={t('mcp.page.search.placeholder')}
      filters={controller.filterGroups}
      activeFilters={controller.activeFilters}
      onFilterChange={controller.handleFilterChange}
      actions={
        <ServerEditorDialog
          mode="create"
          trigger={
            <Button type="button" variant="toolbar" size="toolbar">
              <Plus className="size-3.5" />
              <span>{t('mcp.server.create.button')}</span>
            </Button>
          }
        />
      }
    >
      {controller.isInitialLoading ? null : controller.filteredServers.length > 0 ? (
        <div className="space-y-8">
          {controller.enabledServers.length > 0 ? (
            <ServersGrid
              title={t('common.status.enabled')}
              servers={controller.enabledServers}
              onServerClick={controller.setSelectedServerId}
            />
          ) : null}
          {controller.disabledServers.length > 0 ? (
            <ServersGrid
              title={t('common.status.disabled')}
              servers={controller.disabledServers}
              defaultOpen={controller.enabledServers.length === 0}
              onServerClick={controller.setSelectedServerId}
            />
          ) : null}
        </div>
      ) : controller.resolvedServers.length === 0 ? (
        <EmptyState
          icon={Server}
          title={t('mcp.page.empty.title')}
          description={t('mcp.page.empty.description')}
          className="h-full flex-1"
          action={<ServerEditorDialog mode="create" />}
        />
      ) : (
        <EmptyState
          icon={Server}
          title={t('mcp.page.empty.noMatch.title')}
          description={t('mcp.page.empty.noMatch.description')}
          className="h-full flex-1"
          searchQuery={controller.searchQuery}
        />
      )}
    </ListPageScaffold>
  )
}
