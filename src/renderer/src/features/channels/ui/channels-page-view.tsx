import { ChevronDown, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  CHANNEL_IDS,
  CHANNEL_META,
  type ChannelId,
  type ChatBridgeStatus
} from '@shared/chat-bridge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ListPageScaffold } from '@/components/layout/page-scaffold'
import { CollapsibleGrid } from '@/components/ui/collapsible-grid'
import { useChatBridgeStatus } from '@/features/chat-bridge/model/queries'
import { useChannelDetailStore } from '../model/store'
import { ChannelCard } from './channel-list/channel-card'
import { openChannelConsole } from '../model/channel-links'
import { ChannelDetailView } from './channel-detail/channel-detail-view'

function isConfigured(status: ChatBridgeStatus | undefined, id: ChannelId): boolean {
  const c = status?.channels[id]
  return !!c && (c.secretConfigured || c.state === 'connected' || c.state === 'error')
}

export function ChannelsPageView(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedChannelId = useChannelDetailStore((s) => s.selectedChannelId)
  const setSelected = useChannelDetailStore((s) => s.setSelectedChannelId)
  const { data: status } = useChatBridgeStatus()

  if (selectedChannelId) {
    return <ChannelDetailView channelId={selectedChannelId} />
  }

  const configured = CHANNEL_IDS.filter((id) => isConfigured(status, id))
  const available = CHANNEL_IDS.filter((id) => !isConfigured(status, id))

  const renderCard = (id: ChannelId): React.ReactNode => (
    <ChannelCard key={id} channelId={id} status={status?.channels[id]} onClick={setSelected} />
  )

  return (
    <ListPageScaffold
      title={t('channels.page.title', { defaultValue: 'Channels' })}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="toolbar" size="toolbar" />}>
            <span>{t('channels.actions.consoleMenu', { defaultValue: 'Console' })}</span>
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {CHANNEL_IDS.map((id) => (
              <DropdownMenuItem key={id} onClick={() => openChannelConsole(id)}>
                <span>{t(`channels.name.${id}`, { defaultValue: CHANNEL_META[id].name })}</span>
                <ExternalLink className="ml-auto size-3 text-muted-foreground" />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex flex-col gap-6">
        {configured.length > 0 ? (
          <CollapsibleGrid
            title={t('channels.section.configured', { defaultValue: 'Configured' })}
            items={configured}
            renderItem={renderCard}
            getItemKey={(id) => id}
          />
        ) : null}
        <CollapsibleGrid
          title={t('channels.section.available', { defaultValue: 'Available' })}
          items={available}
          renderItem={renderCard}
          getItemKey={(id) => id}
        />
      </div>
    </ListPageScaffold>
  )
}
