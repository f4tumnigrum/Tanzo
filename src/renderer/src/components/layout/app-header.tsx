import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWindowControlsVisible } from '@/components/ui/window-controls'
import { useAppShellStore } from '@/app/app-shell-store'
import { useRouteActive } from '@/app/route-activity'

export interface AppHeaderStat {
  value: number
  label: string
}

export interface AppHeaderContentProps {
  title: string

  stats?: AppHeaderStat[]
  onBack?: () => void
  actions?: ReactNode
}

interface AppHeaderOutletContextValue {
  outlet: HTMLDivElement | null
  setOutlet: (element: HTMLDivElement | null) => void
}

const AppHeaderOutletContext = createContext<AppHeaderOutletContextValue | null>(null)

export function AppHeaderProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [outlet, setOutlet] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({ outlet, setOutlet }), [outlet])
  return <AppHeaderOutletContext.Provider value={value}>{children}</AppHeaderOutletContext.Provider>
}

function SidebarToggleButton(): React.JSX.Element {
  const { t } = useTranslation()
  const sidebarCollapsed = useAppShellStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useAppShellStore((state) => state.toggleSidebar)
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
            variant="toolbar"
            size="toolbar-icon"
            className="app-no-drag -ml-1"
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

function WindowControlsInset(): React.JSX.Element | null {
  const sidebarCollapsed = useAppShellStore((state) => state.sidebarCollapsed)
  const controlsVisible = useWindowControlsVisible()
  if (!sidebarCollapsed || !controlsVisible) return null
  return <div className="app-no-drag w-(--traffic-lights-width) shrink-0" aria-hidden="true" />
}

export function AppHeader(): React.JSX.Element {
  const { setOutlet } = useAppHeaderOutlet()

  return (
    <div className="app-titlebar flex h-(--titlebar-height) shrink-0 items-center gap-2 px-5">
      <WindowControlsInset />
      <SidebarToggleButton />
      <div ref={setOutlet} className="flex h-full min-w-0 flex-1 items-center gap-2" />
    </div>
  )
}

export function AppHeaderContent({
  title,
  stats,
  onBack,
  actions
}: AppHeaderContentProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { outlet } = useAppHeaderOutlet()
  const routeActive = useRouteActive()

  if (!routeActive || !outlet) return null

  const visibleStats = stats?.filter((stat) => stat.value > 0) ?? []

  return createPortal(
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {onBack ? (
          <Button
            onClick={onBack}
            type="button"
            variant="toolbar"
            size="toolbar"
            className="app-no-drag -ml-1 gap-1 px-2 text-[0.6875rem]"
            aria-label={t('common.actions.goBack')}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span>{t('common.actions.back')}</span>
          </Button>
        ) : null}

        <div className="ml-1 flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-[0.875rem] font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          {visibleStats.length > 0 ? (
            <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground/80">
              {visibleStats.map((stat, index) => (
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

      {actions ? <div className="app-no-drag flex items-center gap-1">{actions}</div> : null}
    </>,
    outlet
  )
}

function useAppHeaderOutlet(): AppHeaderOutletContextValue {
  const value = useContext(AppHeaderOutletContext)
  if (!value) {
    throw new Error('AppHeader components must be rendered inside <AppHeaderProvider>')
  }
  return value
}
