import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface CollapsibleGridProps<T> {
  title: string
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  getItemKey: (item: T) => string | number
  defaultOpen?: boolean

  pageSize?: number
}

const PAGINATION_MAX_VISIBLE = 5

function buildPageNumbers(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= PAGINATION_MAX_VISIBLE + 2) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const pages: (number | 'ellipsis')[] = [1]
  const windowStart = Math.max(2, currentPage - 1)
  const windowEnd = Math.min(totalPages - 1, currentPage + 1)
  if (windowStart > 2) pages.push('ellipsis')
  for (let page = windowStart; page <= windowEnd; page += 1) pages.push(page)
  if (windowEnd < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}

export function CollapsibleGrid<T>({
  title,
  items,
  renderItem,
  getItemKey,
  defaultOpen = true,
  pageSize
}: CollapsibleGridProps<T>) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [requestedPage, setRequestedPage] = useState(0)

  const pageCount = pageSize ? Math.ceil(items.length / pageSize) : 1

  const page = Math.min(requestedPage, Math.max(0, pageCount - 1))

  const visibleItems = useMemo(() => {
    if (!pageSize) return items
    const start = page * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  const pageNumbers = useMemo(() => buildPageNumbers(page + 1, pageCount), [page, pageCount])

  if (items.length === 0) {
    return null
  }

  const showPager = pageSize !== undefined && pageCount > 1
  const rangeStart = pageSize ? page * pageSize + 1 : 1
  const rangeEnd = pageSize ? Math.min((page + 1) * pageSize, items.length) : items.length

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="group/section">
      <CollapsibleTrigger className="group/trigger relative flex w-full items-center gap-2.5 rounded-md px-0.5 py-2 transition-colors duration-200 shadow-none hover:shadow-none focus-visible:shadow-none">
        <div
          className={cn(
            'ml-1 h-3.5 w-0.5 rounded-full transition-colors duration-200',
            isOpen ? 'bg-foreground/70' : 'bg-muted-foreground/30',
            'group-hover/trigger:bg-foreground/60'
          )}
        />
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground/70 transition-all duration-300 ease-out',
            'group-hover/trigger:text-foreground/80',
            isOpen && 'rotate-90 text-foreground'
          )}
        />
        <h2
          className={cn(
            'text-[0.8125rem] font-semibold tracking-tight transition-colors duration-200',
            isOpen ? 'text-foreground' : 'text-foreground/80'
          )}
        >
          {title}
        </h2>
        <span className="text-[0.6875rem] font-medium tabular-nums text-muted-foreground/70">
          {items.length}
        </span>
        <div className="relative h-px flex-1 overflow-hidden">
          <div
            className={cn(
              'absolute inset-0 bg-gradient-to-r from-border/50 via-border/20 to-transparent transition-colors duration-200',
              'group-hover/trigger:from-border/60 group-hover/trigger:via-border/30',
              isOpen && 'from-border/70 via-border/35'
            )}
          />
          <div
            className={cn(
              'absolute left-0 top-0 h-full w-1/4 bg-gradient-to-r from-transparent via-foreground/12 to-transparent',
              'translate-x-[-120%] transition-transform duration-700 ease-out',
              'group-hover/trigger:translate-x-[380%]'
            )}
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent
        className={cn(
          'transition-all duration-300 ease-out',
          'data-[state=closed]:animate-out data-[state=open]:animate-in',
          'data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1'
        )}
      >
        <div className="pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleItems.map((item, index) => (
              <div key={getItemKey(item)}>{renderItem(item, index)}</div>
            ))}
          </div>
          {showPager ? (
            <div className="flex flex-col gap-2 px-1 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.6875rem] tabular-nums text-muted-foreground">
                {t('common.pagination.showing', {
                  start: rangeStart,
                  end: rangeEnd,
                  total: items.length
                })}
              </p>
              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-xl"
                  disabled={page === 0}
                  onClick={() => setRequestedPage(Math.max(0, page - 1))}
                  aria-label={t('common.actions.prev')}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                {pageNumbers.map((item, index) =>
                  item === 'ellipsis' ? (
                    <span key={`ellipsis-${index}`} className="px-1 text-xs text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      type="button"
                      variant={item === page + 1 ? 'secondary' : 'ghost'}
                      size="icon-sm"
                      className="rounded-xl text-[0.6875rem]"
                      onClick={() => setRequestedPage(item - 1)}
                      aria-label={t('common.pagination.goToPage', { page: item })}
                      aria-current={item === page + 1 ? 'page' : undefined}
                    >
                      {item}
                    </Button>
                  )
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-xl"
                  disabled={page >= pageCount - 1}
                  onClick={() => setRequestedPage(Math.min(pageCount - 1, page + 1))}
                  aria-label={t('common.actions.next')}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
