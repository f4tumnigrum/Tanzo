import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  CardDescription,
  CardDivider,
  CardFooter,
  CardHeader,
  CardStatusBadge,
  FeatureCard
} from '@/components/ui/feature-card'
import { cn } from '@/lib/utils'
import { CHANNEL_META, type ChannelId, type ChannelStatus } from '@shared/chat-bridge'
import { CHANNEL_PRESENTATION } from '../../model/channel-presentation'

interface ChannelCardProps {
  channelId: ChannelId
  status?: ChannelStatus
  onClick?: (channelId: ChannelId) => void
}

export function ChannelCard({ channelId, status, onClick }: ChannelCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const meta = CHANNEL_META[channelId]
  const presentation = CHANNEL_PRESENTATION[channelId]
  const connected = status?.state === 'connected'

  const statusText = connected
    ? t('channels.status.connected', { defaultValue: 'Connected' })
    : status?.state === 'error'
      ? t('channels.status.error', { defaultValue: 'Error' })
      : status?.secretConfigured
        ? t('channels.status.configured', { defaultValue: 'Configured' })
        : t('channels.status.notConfigured', { defaultValue: 'Not configured' })

  return (
    <FeatureCard onClick={() => onClick?.(channelId)}>
      <div className="flex-1">
        <CardHeader
          title={t(`channels.name.${channelId}`, { defaultValue: meta.name })}
          badge={
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
                presentation.accent
              )}
            >
              {presentation.icon}
            </span>
          }
        >
          <CardDescription>
            {t(`channels.tagline.${channelId}`, {
              defaultValue:
                meta.transport === 'outbound'
                  ? 'Outbound connection · no public server needed'
                  : 'Webhook · needs a public HTTPS URL'
            })}
          </CardDescription>
        </CardHeader>
      </div>

      <CardDivider />

      <CardFooter>
        <CardStatusBadge
          active={connected}
          activeIcon={<CheckCircle2 className="size-3 text-background" />}
          activeText={statusText}
          inactiveText={statusText}
        />
      </CardFooter>
    </FeatureCard>
  )
}
