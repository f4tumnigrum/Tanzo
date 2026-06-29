import { Download, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { pageHeaderIconBtnCls } from '@/components/layout/page-header'
import { ListPageScaffold } from '@/components/layout/page-scaffold'
import { cn } from '@/lib/utils'
import type { useSkillsPageController } from '../model'
import { InstallDialog } from './install-dialog'
import { SkillDetailView } from './skill-detail-view'
import { SkillsGrid } from './skills-grid'
import { UninstallDialog } from './uninstall-dialog'

type SkillsPageController = ReturnType<typeof useSkillsPageController>

const SKILL_PAGE_SIZE = 12

export function SkillsPageView({
  controller
}: {
  controller: SkillsPageController
}): React.ReactElement {
  const { t } = useTranslation()

  if (controller.selectedName) {
    return (
      <>
        {controller.selectedSkill ? (
          <SkillDetailView
            skill={controller.selectedSkill}
            onBack={controller.closeDetail}
            onToggle={(enabled) => void controller.toggleSkill(controller.selectedSkill!, enabled)}
            onUninstall={(skill) => controller.setDeleteTarget(skill)}
          />
        ) : (
          <div className="flex h-full flex-1 items-center justify-center">
            <Spinner className="size-4" />
          </div>
        )}
        <UninstallDialog
          skill={controller.deleteTarget}
          onConfirm={() => void controller.confirmUninstall()}
          onOpenChange={(open) => {
            if (!open) controller.setDeleteTarget(null)
          }}
        />
      </>
    )
  }

  return (
    <>
      <ListPageScaffold
        title={t('skills.page.title')}
        stats={controller.stats}
        searchValue={controller.searchValue}
        searchPlaceholder={t('skills.page.search.placeholder')}
        onSearchChange={controller.setSearchValue}
        filters={controller.filterGroups}
        activeFilters={controller.activeFilters}
        onFilterChange={controller.handleFilterChange}
        actions={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(pageHeaderIconBtnCls, 'w-auto gap-1.5 px-2.5')}
              onClick={() => controller.setInstallOpen(true)}
            >
              <Download className="size-3.5" />
              <span className="text-xs">{t('skills.page.actions.install')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(pageHeaderIconBtnCls, 'w-auto gap-1.5 px-2.5')}
              onClick={() => void controller.reload()}
            >
              <RefreshCw className={cn('size-3.5', controller.reloading && 'animate-spin')} />
              <span className="text-xs">{t('skills.page.actions.reload')}</span>
            </Button>
          </div>
        }
      >
        {controller.loading ? null : controller.filteredSkills.length > 0 ? (
          <div className="space-y-8">
            {controller.enabledSkills.length > 0 ? (
              <SkillsGrid
                title={t('common.status.enabled')}
                skills={controller.enabledSkills}
                pageSize={SKILL_PAGE_SIZE}
                onOpen={controller.openDetail}
                onToggle={(selected, enabled) => void controller.toggleSkill(selected, enabled)}
              />
            ) : null}
            {controller.disabledSkills.length > 0 ? (
              <SkillsGrid
                title={t('common.status.disabled')}
                skills={controller.disabledSkills}
                defaultOpen={controller.enabledSkills.length === 0}
                pageSize={SKILL_PAGE_SIZE}
                onOpen={controller.openDetail}
                onToggle={(selected, enabled) => void controller.toggleSkill(selected, enabled)}
              />
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={Sparkles}
            title={t('skills.page.empty.title')}
            description={t('skills.page.empty.description')}
            searchQuery={controller.searchValue}
          />
        )}
      </ListPageScaffold>

      <InstallDialog
        open={controller.installOpen}
        installing={controller.installing}
        onOpenChange={controller.setInstallOpen}
        onInstall={controller.installSkill}
      />
      <UninstallDialog
        skill={controller.deleteTarget}
        onConfirm={() => void controller.confirmUninstall()}
        onOpenChange={(open) => {
          if (!open) controller.setDeleteTarget(null)
        }}
      />
    </>
  )
}
