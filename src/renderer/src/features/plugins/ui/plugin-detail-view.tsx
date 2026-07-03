import { AtSign, Boxes, CircleAlert, FolderOpen, Hash, Tag, Trash2, Webhook } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EntityDetailScaffold } from '@/components/layout/page-scaffold'
import { cn } from '@/lib/utils'
import type { PluginDetail, PluginSummary } from '@shared/plugins'

const SECTION_CLASS = cn(
  'not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15',
  'bg-card/85 shadow-sm backdrop-blur-sm'
)
const SECTION_TITLE_CLASS =
  'px-4 py-2.5 text-[0.625rem] font-medium uppercase tracking-[0.05em] text-foreground/45'
const CODE_CLASS =
  'rounded-[4px] bg-muted/30 px-1.5 py-0.5 font-mono text-[length:var(--code-font-size-sm)] text-foreground/75'

export function PluginDetailView({
  plugin,
  detail,
  onBack,
  onToggle,
  onUninstall
}: {
  /** Always present (from the snapshot); drives the header instantly. */
  plugin: PluginSummary
  /** Full detail (path, keywords, MCP names); arrives after a fetch. */
  detail: PluginDetail | null
  onBack: () => void
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const name = plugin.displayName ?? plugin.pluginName
  const skillPrefix = `${name}:`

  const hasContributions =
    plugin.contributes.skills || plugin.contributes.mcpServers > 0 || plugin.contributes.hooks
  const category = detail?.category
  const root = detail?.root
  const keywords = detail?.keywords ?? []
  const hasAbout = Boolean(category) || Boolean(root) || keywords.length > 0

  return (
    <EntityDetailScaffold
      title={name}
      onBack={onBack}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] text-muted-foreground">
            {plugin.enabled ? t('common.status.enabled') : t('common.status.disabled')}
          </span>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={onToggle}
            aria-label={t('plugins.actions.toggle')}
            className="scale-75"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onUninstall}
            aria-label={t('plugins.actions.uninstall')}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-3 pt-1">
        {/* Identity hero — what this is, at a glance */}
        <section className={cn(SECTION_CLASS, 'p-4')}>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-[0.9375rem] font-semibold leading-tight tracking-[0.01em] text-foreground">
                {name}
              </h2>
              <Badge
                variant="outline"
                className="h-4.5 rounded-md px-1.5 text-[0.625rem] leading-none"
              >
                {plugin.marketplaceName}
              </Badge>
              <Badge
                variant="secondary"
                className="h-4.5 gap-1 rounded-md px-1.5 font-mono text-[length:var(--code-font-size-sm)] leading-none"
              >
                <Tag className="size-2.5" />
                {plugin.version}
              </Badge>
            </div>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              {plugin.description ?? t('plugins.card.noDescription')}
            </p>
          </div>

          {plugin.error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.06] px-3 py-2">
              <CircleAlert className="mt-px size-3.5 shrink-0 text-destructive" />
              <p className="min-w-0 break-words text-[0.6875rem] leading-4 text-destructive/90">
                {plugin.error}
              </p>
            </div>
          ) : null}
        </section>

        {/* @mention hint — the primary way to use an enabled plugin */}
        {plugin.enabled && !plugin.error ? (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-xl)] border border-border/15 bg-foreground/[0.025] px-3.5 py-2.5">
            <AtSign className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[0.6875rem] leading-4 text-foreground/70">
              {t('plugins.detail.mentionHint', { name })}
            </p>
          </div>
        ) : null}

        {/* Contributions — what the plugin adds to your workspace */}
        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>{t('plugins.detail.contributes')}</h3>
          {hasContributions ? (
            <div className="divide-y divide-border/10 border-t border-border/10">
              {plugin.contributes.skills ? (
                <CapabilityRow icon={Hash} title={t('plugins.contributes.skills')}>
                  <span>{t('plugins.detail.skillsPrefix')} </span>
                  <code className={CODE_CLASS}>{skillPrefix}</code>
                </CapabilityRow>
              ) : null}
              {detail && detail.mcpServerNames.length > 0 ? (
                <CapabilityRow
                  icon={Boxes}
                  title={t('plugins.contributes.mcp', { count: detail.mcpServerNames.length })}
                >
                  <div className="flex flex-wrap gap-1">
                    {detail.mcpServerNames.map((server) => (
                      <code key={server} className={CODE_CLASS}>
                        {server}
                      </code>
                    ))}
                  </div>
                </CapabilityRow>
              ) : null}
              {plugin.contributes.hooks ? (
                <CapabilityRow icon={Webhook} title={t('plugins.contributes.hooks')}>
                  {t('plugins.detail.hooksActive')}
                </CapabilityRow>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-border/10 px-4 py-3 text-[0.6875rem] text-foreground/40">
              {t('plugins.detail.noContributions')}
            </p>
          )}
        </section>

        {/* About — reference metadata, lowest priority */}
        {hasAbout ? (
          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>{t('plugins.detail.about')}</h3>
            <dl className="divide-y divide-border/10 border-t border-border/10">
              {category ? (
                <InfoRow icon={Boxes} label={t('plugins.detail.category')}>
                  {category}
                </InfoRow>
              ) : null}
              {root ? (
                <InfoRow icon={FolderOpen} label={t('plugins.detail.path')}>
                  <span className="break-all font-mono text-[length:var(--code-font-size-sm)]">{root}</span>
                </InfoRow>
              ) : null}
              {keywords.length > 0 ? (
                <InfoRow icon={Tag} label={t('plugins.detail.keywords')}>
                  <div className="flex flex-wrap gap-1">
                    {keywords.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="secondary"
                        className="h-5 rounded-md px-1.5 text-[0.625rem] font-normal"
                      >
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </InfoRow>
              ) : null}
            </dl>
          </section>
        ) : null}
      </div>
    </EntityDetailScaffold>
  )
}

function CapabilityRow({
  icon: Icon,
  title,
  children
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-muted/35 text-foreground/65 ring-1 ring-inset ring-border/15">
        <Icon className="size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.75rem] font-medium text-foreground/85">{title}</div>
        <div className="mt-1 text-[0.6875rem] leading-4 text-foreground/55">{children}</div>
      </div>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  children
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-[0.6875rem] text-foreground/52">
        <Icon className="size-2.5 text-foreground/40" />
        {label}
      </span>
      <div className="min-w-0 flex-1 break-words text-[0.6875rem] text-foreground/82">
        {children}
      </div>
    </div>
  )
}
