import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AppHeaderContent, type AppHeaderStat } from '@/components/layout/app-header'
import { SearchInput, type ActiveFilters, type FilterGroup } from '@/components/ui/search-input'
import { cn } from '@/lib/utils'

export type { ActiveFilters, FilterGroup, AppHeaderStat }

export interface PageScaffoldProps {
  title: string
  stats?: AppHeaderStat[]
  actions?: ReactNode
  onBack?: () => void
  children: ReactNode
}

export interface ListPageScaffoldProps extends PageScaffoldProps {
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  filters?: FilterGroup[]
  activeFilters?: ActiveFilters
  onFilterChange?: (key: string, value: string | undefined) => void
  contentClassName?: string
  scrollClassName?: string
}

export function ListPageScaffold({
  title,
  stats,
  actions,
  onBack,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  activeFilters,
  onFilterChange,
  contentClassName,
  scrollClassName,
  children
}: ListPageScaffoldProps) {
  const { t } = useTranslation()
  const showSearch = searchValue !== undefined && onSearchChange !== undefined
  const resolvedPlaceholder = searchPlaceholder ?? t('common.search.placeholder')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AppHeaderContent title={title} stats={stats} actions={actions} onBack={onBack} />

      <div className={cn('flex-1 overflow-y-auto scrollbar-elegant', scrollClassName)}>
        <div className="flex min-h-full flex-col">
          {showSearch ? (
            <div className="sticky top-0 z-10 shrink-0">
              <div className="px-5 py-4">
                <SearchInput
                  value={searchValue}
                  onChange={onSearchChange}
                  placeholder={resolvedPlaceholder}
                  filters={filters}
                  activeFilters={activeFilters}
                  onFilterChange={onFilterChange}
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-1 flex-col">
            <div className={cn('flex w-full flex-1 flex-col px-5 pb-6', contentClassName)}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface EntityDetailScaffoldProps extends PageScaffoldProps {
  contentClassName?: string
  scrollClassName?: string
}

export function EntityDetailScaffold({
  title,
  stats,
  actions,
  onBack,
  contentClassName,
  scrollClassName,
  children
}: EntityDetailScaffoldProps) {
  return (
    <ListPageScaffold
      title={title}
      stats={stats}
      actions={actions}
      onBack={onBack}
      contentClassName={contentClassName}
      scrollClassName={scrollClassName}
    >
      {children}
    </ListPageScaffold>
  )
}
