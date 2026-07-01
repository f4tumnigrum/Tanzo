import type { ReactNode } from 'react'
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWindowControlsVisible } from '@/components/ui/window-controls'
import { useAppShell } from '@/app/app-shell-context'

export interface PageHeaderStat {
  value: number
  label: string
}

export function SidebarToggleButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { sidebarCollapsed, toggleSidebar } = useAppShell()
  const label = sidebarCollapsed
    ? t('chat.sidebar.expandSidebar')
    : t('chat.sidebar.collapseSidebar')

  return (
    <Tooltip>
      <TooltipTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(pageHeaderIconBtnCls, className)}
            onClick={toggleSidebar}
            aria-label={label}
            aria-pressed={sidebarCollapsed}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
          </Button>
        )}
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * When the sidebar is collapsed the persistent traffic-light overlay (owned by
 * the shell) sits at the window's top-left, directly over the start of the
 * header row. Reserve matching space so the header content does not slide under
 * it. Renders nothing when the sidebar is expanded (the lights sit over the
 * sidebar instead) or on platforms with no custom overlay.
 */
function WindowControlsInset() {
  const { sidebarCollapsed } = useAppShell()
  const controlsVisible = useWindowControlsVisible()
  if (!sidebarCollapsed || !controlsVisible) return null
  return <div className="app-no-drag w-[108px] shrink-0" aria-hidden="true" />
}

export const pageHeaderIconBtnCls = cn(
  'app-no-drag inline-flex items-center justify-center',
  'h-7 w-7 p-0 rounded-md',
  'border-0 bg-transparent shadow-none',
  'text-muted-foreground transition-colors duration-150',
  'hover:bg-foreground/[0.06] hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
  '[&_svg]:size-4'
)

export interface PageHeaderProps {
  title: string
  titleMeta?: ReactNode
  stats?: PageHeaderStat[]
  onBack?: () => void
  leadingActions?: ReactNode
  actions?: ReactNode
}

export function PageHeader({
  title,
  titleMeta,
  stats,
  onBack,
  leadingActions,
  actions
}: PageHeaderProps) {
  const { t } = useTranslation()
  const totalCount = stats?.[0]?.value ?? 0

  return (
    <div className="app-titlebar flex h-11 shrink-0 items-center gap-2 px-5">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <WindowControlsInset />
        <SidebarToggleButton className="-ml-1" />
        {leadingActions ? <div className="flex items-center gap-1">{leadingActions}</div> : null}
        {onBack ? (
          <Button
            onClick={onBack}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(pageHeaderIconBtnCls, 'w-auto gap-1 px-2', '-ml-1')}
            aria-label={t('common.actions.goBack')}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span className="text-[0.6875rem] font-medium">{t('common.actions.back')}</span>
          </Button>
        ) : null}

        <div className="ml-1 flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-[0.875rem] font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          {titleMeta ? <div className="min-w-0 max-w-[40vw] shrink">{titleMeta}</div> : null}
          {totalCount > 0 && stats && stats.length > 0 ? (
            <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground/80">
              {stats.map((stat, index) => (
                <span key={stat.label} className="flex items-center gap-1">
                  {index > 0 ? (
                    <span className="text-muted-foreground/30" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  <span className="font-medium tabular-nums text-foreground/80">{stat.value}</span>
                  <span>{stat.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="app-no-drag flex items-center gap-1 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:rounded-md [&_[data-slot=button]]:text-[0.6875rem] [&_[data-slot=button]]:font-medium">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
