import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWindowControlsVisible } from '@/components/ui/window-controls'
import { useAppShellStore } from '@/app/app-shell-store'
import { useRouteActive } from '@/app/route-activity'

/**
 * App-level header.
 *
 * The shell renders exactly one `<AppHeader />` at the top of the content
 * column. It owns every piece of window chrome: the drag strip, the
 * traffic-light inset, the sidebar toggle and the row layout. Pages never
 * render a header of their own — they project structured content (title,
 * stats, back button, actions) into the shell header through
 * `<AppHeaderContent />`, which portals into the header's outlet.
 *
 * Exactly one route may write header content at a time. Keep-alive routes
 * stay mounted while hidden, so `AppHeaderContent` gates on `useRouteActive()`
 * and renders nothing for inactive routes.
 */

export interface AppHeaderStat {
  value: number
  label: string
}

export interface AppHeaderContentProps {
  title: string
  /** Zero-valued stats are omitted; an all-zero list renders nothing. */
  stats?: AppHeaderStat[]
  onBack?: () => void
  actions?: ReactNode
}

interface AppHeaderOutletContextValue {
  outlet: HTMLDivElement | null
  setOutlet: (element: HTMLDivElement | null) => void
}

const AppHeaderOutletContext = createContext<AppHeaderOutletContextValue | null>(null)

/** Wraps the shell so `AppHeader` (owner) and pages (writers) share the outlet. */
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

/**
 * When the sidebar is collapsed the persistent traffic-light overlay (owned by
 * the shell) sits at the window's top-left, directly over the start of the
 * header row. Reserve matching space so header content does not slide under
 * it. Renders nothing when the sidebar is expanded (the lights sit over the
 * sidebar instead) or on platforms with no custom overlay.
 */
function WindowControlsInset(): React.JSX.Element | null {
  const sidebarCollapsed = useAppShellStore((state) => state.sidebarCollapsed)
  const controlsVisible = useWindowControlsVisible()
  if (!sidebarCollapsed || !controlsVisible) return null
  return <div className="app-no-drag w-(--traffic-lights-width) shrink-0" aria-hidden="true" />
}

/** The single shell-owned header row. Rendered once, above the routed content. */
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

/** Projects page content into the shell header. No-op while the route is hidden. */
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
