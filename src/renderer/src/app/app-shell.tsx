import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useGroupRef, usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import { ConversationSidebar } from '@/features/chat/ui/conversation/conversation-sidebar'
import { SettingsNav } from '@/features/settings/ui/settings-nav'
import { WindowControls, useWindowControlsVisible } from '@/components/ui/window-controls'
import { useChatNavigation } from '@/features/chat/model/use-chat-navigation'
import { AppShellContext, type AppShellContextValue } from './app-shell-context'

const DEFAULT_LAYOUT = { sidebar: 28, content: 72 } as const

export interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const groupRef = useGroupRef()
  const sidebarPanelRef = usePanelRef()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const isSettings = pathname.startsWith('/settings')
  const navigation = useChatNavigation()
  const windowControlsVisible = useWindowControlsVisible()

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const layout = group.getLayout()
    if ((layout.sidebar ?? 0) < 10) {
      group.setLayout(DEFAULT_LAYOUT)
    }
  }, [groupRef])

  useEffect(() => {
    const panel = sidebarPanelRef.current
    if (!panel) return
    const collapsed = panel.isCollapsed()
    if (collapsed === sidebarCollapsed) return
    if (sidebarCollapsed) panel.collapse()
    else panel.expand()
  }, [sidebarCollapsed, sidebarPanelRef])

  const handleSidebarResize = useCallback(() => {
    const panel = sidebarPanelRef.current
    if (!panel) return
    setSidebarCollapsed(panel.isCollapsed())
  }, [sidebarPanelRef])

  const toggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [])

  const contextValue = useMemo<AppShellContextValue>(
    () => ({ sidebarCollapsed, toggleSidebar }),
    [sidebarCollapsed, toggleSidebar]
  )

  return (
    <AppShellContext.Provider value={contextValue}>
      {/* A single persistent traffic-light overlay pinned to the window's
          top-left corner. It never unmounts as the sidebar collapses/expands,
          so the controls never flash. */}
      {windowControlsVisible ? (
        <div className="app-no-drag pointer-events-auto fixed left-0 top-0 z-[1000] flex h-11 w-[108px] items-center px-5">
          <WindowControls className="app-no-drag pointer-events-auto" />
        </div>
      ) : null}
      <ResizablePanelGroup
        id="app-shell"
        orientation="horizontal"
        defaultLayout={DEFAULT_LAYOUT}
        groupRef={groupRef}
        className="h-full min-h-0 w-full min-w-0 bg-transparent"
      >
        <ResizablePanel
          key="sidebar"
          id="sidebar"
          defaultSize="28%"
          minSize="18%"
          maxSize="40%"
          collapsible
          panelRef={sidebarPanelRef}
          onResize={handleSidebarResize}
          className="min-h-0 min-w-0 transition-[flex-basis] duration-200 ease-linear"
        >
          <div className="sidebar-surface flex h-full min-h-0 w-full min-w-0 flex-col">
            <div className="app-titlebar h-11 shrink-0">
              <div className="app-no-drag h-full w-[108px]" aria-hidden="true" />
            </div>
            <div className="min-h-0 flex-1">
              {isSettings ? (
                <SettingsNav />
              ) : (
                <ConversationSidebar
                  sidebar={navigation.sidebarModel}
                  onConversationSelect={navigation.handleSelectConversation}
                  onConversationDelete={navigation.handleDelete}
                  onConversationRename={navigation.handleRename}
                  onNewConversation={navigation.handleNewConversation}
                  onWorkspaceConversationCreate={navigation.handleWorkspaceConversationCreate}
                  onWorkspaceRemove={navigation.handleWorkspaceRemove}
                  onToggleWorkspaceExpanded={navigation.handleToggleWorkspaceExpanded}
                  onPickWorkspace={navigation.handlePickWorkspace}
                />
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle
          id="app-shell-separator"
          disabled={sidebarCollapsed}
          style={{ backgroundColor: 'transparent' }}
          className={cn(
            'relative z-10 w-0 shrink-0 cursor-col-resize overflow-visible bg-transparent',
            'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2',
            'before:bg-gradient-to-b before:from-transparent before:via-foreground/15 before:to-transparent',
            'before:transition-opacity before:duration-200 hover:before:via-foreground/35',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2',
            sidebarCollapsed && 'pointer-events-none opacity-0'
          )}
        >
          <span className="sr-only">{t('common.layout.resizeSidebar')}</span>
        </ResizableHandle>

        <ResizablePanel
          key="content"
          id="content"
          minSize="30%"
          className="min-h-0 min-w-0 transition-[flex-basis] duration-200 ease-linear"
        >
          <div className="main-surface flex h-full min-h-0 min-w-0 flex-col">{children}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </AppShellContext.Provider>
  )
}
