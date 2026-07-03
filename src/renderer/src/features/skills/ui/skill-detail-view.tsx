import { Trash2, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EntityDetailScaffold } from '@/components/layout/page-scaffold'
import { cn } from '@/lib/utils'
import type { SkillDetail } from '@shared/skills'
import { skillTitle } from '../model'
import { ScopeBadge } from './skill-badges'

const SECTION_CLASS = cn(
  'not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15',
  'bg-card/85 shadow-sm backdrop-blur-sm'
)
const SECTION_TITLE_CLASS =
  'px-4 py-2.5 text-[0.625rem] font-medium uppercase tracking-[0.05em] text-foreground/45'

export function SkillDetailView({
  skill,
  onBack,
  onToggle,
  onUninstall
}: {
  skill: SkillDetail
  onBack: () => void
  onToggle: (enabled: boolean) => void
  onUninstall: (skill: SkillDetail) => void
}): React.ReactElement {
  const { t } = useTranslation()
  const title = skillTitle(skill)
  const source = skill.installed ? t('skills.source.localInstall') : t('skills.source.scanned')

  return (
    <EntityDetailScaffold
      title={title}
      onBack={onBack}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] text-muted-foreground">
            {skill.enabled ? t('common.status.enabled') : t('common.status.disabled')}
          </span>
          <Switch
            checked={skill.enabled}
            onCheckedChange={onToggle}
            aria-label={t('skills.card.toggleAria', { name: skill.name })}
            className="scale-75"
          />
          {skill.installed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={() => onUninstall(skill)}
              aria-label={t('skills.detail.uninstall')}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-3 pt-1">
        {/* Identity hero — what this skill is, at a glance */}
        <section className={cn(SECTION_CLASS, 'p-4')}>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-[0.9375rem] font-semibold leading-tight tracking-[0.01em] text-foreground">
                {title}
              </h2>
              <ScopeBadge skill={skill} />
              {skill.installed ? (
                <Badge
                  variant="secondary"
                  className="h-4.5 rounded-md px-1.5 text-[0.625rem] leading-none"
                >
                  {t('skills.detail.badges.installed')}
                </Badge>
              ) : null}
            </div>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              {skill.description}
            </p>
          </div>
        </section>

        {/* Body — the skill instructions themselves, the primary content */}
        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>{t('skills.detail.body.title')}</h3>
          <pre className="scrollbar-elegant max-h-[28rem] overflow-auto whitespace-pre-wrap border-t border-border/10 p-4 text-xs leading-5 text-foreground/85">
            {skill.body || t('skills.detail.body.empty')}
          </pre>
        </section>

        {/* Details — reference metadata, lowest priority */}
        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>{t('skills.detail.sections.details')}</h3>
          <dl className="divide-y divide-border/10 border-t border-border/10">
            <InfoRow label={t('skills.detail.fields.source')}>{source}</InfoRow>
            <InfoRow label={t('skills.detail.fields.allowedTools')}>
              {skill.allowedTools && skill.allowedTools.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {skill.allowedTools.map((tool) => (
                    <Badge
                      key={tool}
                      variant="secondary"
                      className="h-5 gap-1 rounded-md px-1.5 text-[0.625rem] font-normal"
                    >
                      <Wrench className="size-2.5" />
                      {tool}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-foreground/52">{t('skills.detail.values.allTools')}</span>
              )}
            </InfoRow>
            {skill.modelRef ? (
              <InfoRow label={t('skills.detail.fields.model')}>
                <span className="font-mono text-[length:var(--code-font-size-sm)]">{skill.modelRef}</span>
              </InfoRow>
            ) : null}
            {skill.license ? (
              <InfoRow label={t('skills.detail.fields.license')}>{skill.license}</InfoRow>
            ) : null}
            <InfoRow label={t('skills.detail.fields.path')}>
              <span className="break-all font-mono text-[length:var(--code-font-size-sm)]">{skill.skillDir}</span>
            </InfoRow>
          </dl>
        </section>
      </div>
    </EntityDetailScaffold>
  )
}

function InfoRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="w-24 shrink-0 text-[0.6875rem] text-foreground/52">{label}</span>
      <div className="min-w-0 flex-1 break-words text-[0.6875rem] text-foreground/82">
        {children}
      </div>
    </div>
  )
}
