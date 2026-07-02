import { useTranslation } from 'react-i18next'
import { RefreshCw, WifiOff } from 'lucide-react'
import { EntityDetailScaffold } from '@/components/layout/page-scaffold'
import { EmptyState } from '@/components/ui/empty-state'
import { PillTabsBar, PillTabsTrigger } from '@/components/layout/pill-tabs'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  useMcpDetailStore,
  useReconnectServer,
  useServerConnectionState,
  useServerPrompts,
  useServerResources,
  useServerTools
} from '@/features/mcp/model'
import type { McpServerConfig } from '@/common/contracts'
import { ServerDetailInfo } from '../server/server-detail-info'
import { ServerToolsList } from '../server/server-tools-list'
import { ServerPromptsList } from '../server/server-prompts-list'
import { ServerResourcesList } from '../server/server-resources-list'

interface ServerDetailViewProps {
  server: McpServerConfig
}

const DETAIL_CONTENT_CLASS = 'mt-3 flex min-h-0 w-full max-w-4xl flex-1 flex-col'

export function ServerDetailView({ server }: ServerDetailViewProps) {
  const { t } = useTranslation()
  const setSelectedServerId = useMcpDetailStore((s) => s.setSelectedServerId)

  const { state: connectionState } = useServerConnectionState(server.name)
  const isConnected = connectionState?.status === 'connected'

  const { data: tools, isPending: toolsLoading } = useServerTools(server.name, isConnected)
  const { data: prompts, isPending: promptsLoading } = useServerPrompts(server.name, isConnected)
  const { data: resources, isPending: resourcesLoading } = useServerResources(
    server.name,
    isConnected
  )
  const reconnect = useReconnectServer()
  const reconnectDisabled = !server.enabled || reconnect.isPending

  function handleBack() {
    setSelectedServerId(null)
  }

  return (
    <EntityDetailScaffold
      title={server.name}
      onBack={handleBack}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="toolbar"
            size="toolbar"
            disabled={reconnectDisabled}
            onClick={() => reconnect.mutate(server.name)}
          >
            {reconnect.isPending ? (
              <Spinner className="size-3" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {reconnect.isPending
              ? t('mcp.server.detail.reconnecting')
              : t('mcp.server.detail.reconnect')}
          </Button>
        </div>
      }
    >
      <div className="flex w-full flex-1 flex-col">
        <Tabs defaultValue="info" className="flex min-h-0 flex-1 flex-col items-center">
          <PillTabsBar>
            <PillTabsTrigger value="info">{t('mcp.server.detail.tabs.info')}</PillTabsTrigger>
            <PillTabsTrigger value="tools">
              {t('mcp.server.detail.tabs.tools')}
              <TabCount count={tools?.tools.length} />
            </PillTabsTrigger>
            <PillTabsTrigger value="prompts">
              {t('mcp.server.detail.tabs.prompts')}
              <TabCount count={prompts?.prompts.length} />
            </PillTabsTrigger>
            <PillTabsTrigger value="resources">
              {t('mcp.server.detail.tabs.resources')}
              <TabCount count={resources?.resources.length} />
            </PillTabsTrigger>
          </PillTabsBar>

          <TabsContent value="info" className={DETAIL_CONTENT_CLASS}>
            <ServerDetailInfo server={server} />
          </TabsContent>

          <TabsContent value="tools" className={DETAIL_CONTENT_CLASS}>
            {isConnected ? (
              toolsLoading ? (
                <Spinner className="mx-auto mt-8 size-4" />
              ) : (
                <ServerToolsList tools={tools?.tools ?? []} />
              )
            ) : (
              <NotConnected />
            )}
          </TabsContent>

          <TabsContent value="prompts" className={DETAIL_CONTENT_CLASS}>
            {isConnected ? (
              promptsLoading ? (
                <Spinner className="mx-auto mt-8 size-4" />
              ) : (
                <ServerPromptsList prompts={prompts?.prompts ?? []} />
              )
            ) : (
              <NotConnected />
            )}
          </TabsContent>

          <TabsContent value="resources" className={DETAIL_CONTENT_CLASS}>
            {isConnected ? (
              resourcesLoading ? (
                <Spinner className="mx-auto mt-8 size-4" />
              ) : (
                <ServerResourcesList resources={resources?.resources ?? []} />
              )
            ) : (
              <NotConnected />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </EntityDetailScaffold>
  )
}

function TabCount({ count }: { count?: number }) {
  if (count == null || count === 0) return null
  return (
    <span className="ml-0.5 rounded-full bg-foreground/8 px-1.5 py-0.5 text-[0.5625rem] leading-none text-foreground/45">
      {count}
    </span>
  )
}

function NotConnected() {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={WifiOff}
      title={t('mcp.server.detail.notConnected')}
      description={t('mcp.server.detail.notConnectedDescription')}
      className="h-full flex-1"
    />
  )
}
