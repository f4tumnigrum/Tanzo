import { Terminal, Calendar, Wifi, AlertCircle, WifiOff, Globe } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getLocale } from '@/i18n'
import { cn } from '@/lib/utils'
import { parseTimestampOrNull } from '@/common/lib/date-utils'
import type { McpServerConfig, McpServerStatus } from '@/common/contracts'
import { useServerConnectionState } from '@/features/mcp/model'
import { ServerSectionHeader } from './server-section'
import { SERVER_CARD_BODY_CLASS, SERVER_CARD_CLASS } from './server-section-styles'

interface ServerDetailInfoProps {
  server: McpServerConfig
}

const SECTION_CLASS = cn(SERVER_CARD_CLASS, 'divide-y divide-border/10')

const ROW_CLASS = cn('flex items-start gap-3 px-3 py-2.5')

function StatusBadge({ enabled, status }: { enabled: boolean; status: McpServerStatus }) {
  const { t } = useTranslation()
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[5px] border border-border/35 bg-muted/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-foreground/52">
        {t('common.status.disabled')}
      </span>
    )
  }
  if (status === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[5px] border border-amber-500/40 bg-amber-500/[0.06] px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-600/90">
        <Spinner className="size-2.5" />
        {t('mcp.server.status.connecting')}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[5px] border border-red-500/40 bg-red-500/[0.06] px-1.5 py-0.5 text-[0.625rem] font-medium text-red-500/90">
        <AlertCircle className="size-2.5" />
        {t('common.status.error')}
      </span>
    )
  }
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[5px] border border-emerald-500/40 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-600/90">
        <Wifi className="size-2.5" />
        {t('common.status.connected')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] border border-border/35 bg-muted/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-foreground/52">
      <WifiOff className="size-2.5" />
      {t('mcp.server.status.disconnected')}
    </span>
  )
}

export function ServerDetailInfo({ server }: ServerDetailInfoProps) {
  const { t, i18n } = useTranslation()
  const locale = getLocale(i18n?.language)
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale]
  )
  const createdAtLabel = useMemo(() => {
    if (!server.created_at) return null
    const date = parseTimestampOrNull(server.created_at)
    return date ? dateTimeFormatter.format(date) : server.created_at
  }, [dateTimeFormatter, server.created_at])
  const envEntries = Object.entries(server.env ?? {})
  const { state: connectionState } = useServerConnectionState(server.name)
  const status: McpServerStatus = connectionState?.status ?? 'disconnected'
  const toolCount = connectionState?.toolCount ?? 0
  return (
    <div className="w-full max-w-4xl space-y-3">
      <div className={SECTION_CLASS}>
        <div className="px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="text-[0.8125rem] font-medium tracking-[0.01em] text-foreground/90">
                {server.name}
              </h2>
              {server.description ? (
                <p className="text-[0.6875rem] leading-4 text-foreground/52">
                  {server.description}
                </p>
              ) : null}
            </div>
            <StatusBadge enabled={server.enabled} status={status} />
          </div>
        </div>
        <div className={ROW_CLASS}>
          <span className="w-20 shrink-0 text-[0.6875rem] text-foreground/52">
            {t('mcp.server.detail.transport')}
          </span>
          <span className="inline-flex items-center gap-1 rounded-[5px] border border-border/35 bg-muted/15 px-1.5 py-0.5 font-mono text-[length:var(--code-font-size-sm)] font-medium text-foreground/72">
            <Globe className="size-2.5 text-foreground/40" />
            {server.transport.toUpperCase()}
          </span>
        </div>

        {connectionState?.serverInfo ? (
          <div className={ROW_CLASS}>
            <span className="w-20 shrink-0 text-[0.6875rem] text-foreground/52">
              {t('mcp.server.detail.server')}
            </span>
            <span className="text-[length:var(--code-font-size)] font-mono text-foreground/72">
              {connectionState.serverInfo.name}@{connectionState.serverInfo.version}
            </span>
          </div>
        ) : null}

        {status === 'connected' && toolCount > 0 ? (
          <div className={ROW_CLASS}>
            <span className="w-20 shrink-0 text-[0.6875rem] text-foreground/52">
              {t('mcp.server.metrics.toolsCount', { count: toolCount })}
            </span>
            <span className="inline-flex items-center gap-1 rounded-[5px] border border-emerald-500/40 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-600/90">
              {toolCount}
            </span>
          </div>
        ) : null}

        {createdAtLabel ? (
          <div className={ROW_CLASS}>
            <span className="w-20 shrink-0 text-[0.6875rem] text-foreground/52">
              {t('mcp.server.detail.createdAt')}
            </span>
            <span className="flex items-center gap-1 text-[length:var(--code-font-size)] font-mono text-foreground/72">
              <Calendar className="size-2.5 text-foreground/40" />
              {createdAtLabel}
            </span>
          </div>
        ) : null}
      </div>

      {}
      <div className={SERVER_CARD_CLASS}>
        <ServerSectionHeader
          icon={<Terminal className="size-3" />}
          title={t('mcp.server.detail.commandConfig')}
        />
        <div className={SERVER_CARD_BODY_CLASS}>
          {server.transport === 'stdio' ? (
            <>
              <InfoRow label={t('mcp.server.detail.command')} mono>
                {server.command ?? ''}
              </InfoRow>
              {server.args && server.args.length > 0 ? (
                <InfoRow label={t('mcp.server.detail.arguments')} mono>
                  {server.args.join(' ')}
                </InfoRow>
              ) : null}
              {server.cwd ? (
                <InfoRow label={t('mcp.server.detail.cwd')} mono>
                  {server.cwd}
                </InfoRow>
              ) : null}
              <InfoRow label={t('mcp.server.detail.fullCommand')} mono>
                {[server.command ?? '', ...(server.args ?? [])].join(' ')}
              </InfoRow>
            </>
          ) : (
            <>
              <InfoRow label={t('mcp.server.detail.url')} mono>
                {server.url ?? ''}
              </InfoRow>
              {server.redirect ? (
                <InfoRow label={t('mcp.server.form.redirect.label')} mono>
                  {t(`mcp.server.form.redirect.${server.redirect}`)}
                </InfoRow>
              ) : null}
            </>
          )}
        </div>
      </div>

      {}
      {envEntries.length > 0 ? (
        <div className={SERVER_CARD_CLASS}>
          <ServerSectionHeader
            icon={<Terminal className="size-3" />}
            title={t('mcp.server.detail.env')}
          />
          <div className={SERVER_CARD_BODY_CLASS}>
            {envEntries.map(([key, value]) => (
              <div key={key} className={cn(ROW_CLASS, 'gap-2')}>
                <code className="shrink-0 rounded-[4px] bg-muted/25 px-1.5 py-0.5 font-mono text-[length:var(--code-font-size-sm)] text-foreground/72">
                  {key}
                </code>
                <span className="text-[0.625rem] text-foreground/40">=</span>
                <code className="min-w-0 break-all font-mono text-[length:var(--code-font-size-sm)] text-foreground/62">
                  {value}
                </code>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function InfoRow({
  label,
  mono,
  children
}: {
  label: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <div className={ROW_CLASS}>
      <span className="w-20 shrink-0 text-[0.6875rem] text-foreground/52">{label}</span>
      <span
        className={cn('min-w-0 break-all text-[0.6875rem] text-foreground/82', mono && 'font-mono')}
      >
        {children}
      </span>
    </div>
  )
}
