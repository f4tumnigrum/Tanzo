import { useEffect, useMemo, useState, useTransition } from 'react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePanelRef } from 'react-resizable-panels'
import { AppHeaderContent } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { BrowserPanel, useBrowserUiStore, useBrowserOpenRequests } from '@/features/browser'
import { useChatNavigation } from './model/use-chat-navigation'
import { ChatEmpty } from './ui/chat-empty'
import { ActiveChat } from './ui/active-chat'
import { TaskOverviewPill } from './ui/task-overview-pill'
import { StartComposer } from './ui/compose/start-composer'
import { GitReviewDialog, WorkspaceGitPill } from '@/features/git/ui'
import { useGitReviewController } from '@/features/git/model'

export default function ChatPage(): React.JSX.Element {
  const { t } = useTranslation()
  const browserOpen = useBrowserUiStore((s) => s.open)
  const browserMaximized = useBrowserUiStore((s) => s.maximized)
  const toggleBrowser = useBrowserUiStore((s) => s.toggle)
  useBrowserOpenRequests()
  const chatPaneRef = usePanelRef()
  const navigation = useChatNavigation()
  const { activeChatId, activeConversation, currentWorkspace, defaultWorkspace } = navigation
  const [displayedChatId, setDisplayedChatId] = useState<string | null>(activeChatId)
  const [, startChatSwitchTransition] = useTransition()

  const headerTitle = currentWorkspace?.label || activeConversation?.title || t('chat.page.title')

  const gitCwd = activeConversation?.cwd ?? currentWorkspace?.cwd ?? null
  const gitTarget = useMemo(() => (gitCwd ? { cwd: gitCwd } : null), [gitCwd])
  const gitReview = useGitReviewController(gitTarget)
  const [gitReviewOpen, setGitReviewOpen] = useState(false)

  useEffect(() => {
    if (activeChatId === displayedChatId) return undefined

    const frame = window.requestAnimationFrame(() => {
      if (!activeChatId) {
        setDisplayedChatId(null)
        return
      }
      startChatSwitchTransition(() => setDisplayedChatId(activeChatId))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeChatId, displayedChatId, startChatSwitchTransition])

  const isSwitchingChat = activeChatId !== displayedChatId

  useEffect(() => {
    if (!gitCwd) return undefined
    void window.electron?.git?.watch(gitCwd)
    return () => {
      void window.electron?.git?.unwatch(gitCwd)
    }
  }, [gitCwd])

  // Collapse (not unmount) the chat pane when the browser is maximized so the
  // active conversation is preserved.
  useEffect(() => {
    const panel = chatPaneRef.current
    if (!panel) return
    const shouldCollapse = browserOpen && browserMaximized
    if (shouldCollapse === panel.isCollapsed()) return
    if (shouldCollapse) panel.collapse()
    else panel.expand()
  }, [browserOpen, browserMaximized, chatPaneRef])

  const chatContent = activeChatId ? (
    isSwitchingChat || !displayedChatId ? (
      <ChatSwitchShell />
    ) : (
      <ActiveChat
        key={displayedChatId}
        chatId={displayedChatId}
        onForkMessage={navigation.handleForkMessage}
      />
    )
  ) : (
    <ChatEmpty>
      <StartComposer
        workspaceRoot={defaultWorkspace?.cwd ?? null}
        onStart={navigation.handleStartConversation}
      />
    </ChatEmpty>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AppHeaderContent
        title={headerTitle}
        actions={
          <>
            {displayedChatId ? <TaskOverviewPill chatId={displayedChatId} /> : null}
            {gitTarget ? (
              <WorkspaceGitPill
                overview={gitReview.overview}
                loading={gitReview.loading}
                onClick={() => setGitReviewOpen(true)}
              />
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={(triggerProps) => (
                  <Button
                    {...triggerProps}
                    type="button"
                    variant="toolbar"
                    size="toolbar-icon"
                    className="hover:bg-transparent"
                    onClick={toggleBrowser}
                    aria-label={t('browser.toggle')}
                    aria-pressed={browserOpen}
                  >
                    <Globe className="size-4" aria-hidden="true" />
                  </Button>
                )}
              />
              <TooltipContent side="bottom">{t('browser.toggle')}</TooltipContent>
            </Tooltip>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The chat panel keeps a stable position in the tree whether or not the
            browser is open, so toggling the browser never unmounts / reloads the
            active conversation. */}
        <ResizablePanelGroup id="chat-browser" orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel
            id="chat-pane"
            minSize="30%"
            collapsible
            panelRef={chatPaneRef}
            className="min-h-0 min-w-0"
          >
            <div className="@container/chat flex h-full min-h-0 flex-col">{chatContent}</div>
          </ResizablePanel>
          {browserOpen ? (
            <>
              <ResizableHandle
                id="chat-browser-separator"
                disabled={browserMaximized}
                style={{ backgroundColor: 'transparent' }}
                className={cn(
                  'relative z-10 w-0 shrink-0 cursor-col-resize overflow-visible bg-transparent',
                  'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2',
                  'before:bg-gradient-to-b before:from-transparent before:via-foreground/15 before:to-transparent',
                  'before:transition-opacity before:duration-200 hover:before:via-foreground/35',
                  'after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2',
                  browserMaximized && 'pointer-events-none opacity-0'
                )}
              />
              <ResizablePanel
                id="browser-pane"
                defaultSize="42%"
                minSize="25%"
                className="min-h-0 min-w-0"
              >
                <BrowserPanel />
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>
      <GitReviewDialog
        open={gitReviewOpen}
        onOpenChange={setGitReviewOpen}
        controller={gitReview}
      />
    </div>
  )
}

function ChatSwitchShell(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center">
      <Spinner className="size-5 text-foreground/35" />
    </div>
  )
}
