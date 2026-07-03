import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FlaskConical,
  LogIn,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  StopCircle,
  Webhook,
  Wrench
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { HookEntrySummary, HookEvent, HookPreviewResult, HookTrustStatus } from '@shared/hooks'
import { HOOK_EVENTS } from '@shared/hooks'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/common/lib/error-utils'
import { hooksClient } from '@/platform/electron/hooks-client'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHookMutations, useHooksList } from '../model/use-hooks'

const EVENT_ICONS: Partial<Record<HookEvent, LucideIcon>> = {
  SessionStart: LogIn,
  UserPromptSubmit: MessageSquare,
  PreToolUse: Wrench,
  PostToolUse: Wrench,
  Stop: StopCircle
}

interface TrustMeta {
  labelKey: string
  defaultLabel: string
  className: string
  dotClassName: string
}

const TRUST_META: Record<HookTrustStatus, TrustMeta> = {
  managed: {
    labelKey: 'settings.hooks.trust.managed',
    defaultLabel: 'Managed',
    className: 'text-sky-600 dark:text-sky-400',
    dotClassName: 'bg-sky-500'
  },
  trusted: {
    labelKey: 'settings.hooks.trust.trusted',
    defaultLabel: 'Trusted',
    className: 'text-emerald-600 dark:text-emerald-400',
    dotClassName: 'bg-emerald-500'
  },
  modified: {
    labelKey: 'settings.hooks.trust.modified',
    defaultLabel: 'Modified',
    className: 'text-amber-600 dark:text-amber-400',
    dotClassName: 'bg-amber-500'
  },
  untrusted: {
    labelKey: 'settings.hooks.trust.untrusted',
    defaultLabel: 'Untrusted',
    className: 'text-foreground/45',
    dotClassName: 'bg-foreground/25'
  }
}

export function SettingsHooksHeaderActions(): React.JSX.Element {
  const { t } = useTranslation()
  const { reload } = useHookMutations()
  const label = t('settings.hooks.reload', { defaultValue: 'Reload' })
  return (
    <Tooltip>
      <TooltipTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            type="button"
            variant="toolbar"
            size="toolbar-icon"
            disabled={reload.isPending}
            onClick={() => reload.mutate()}
            aria-label={label}
          >
            <RefreshCw className={cn('size-4', reload.isPending && 'animate-spin')} />
          </Button>
        )}
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function PreviewBlock({ preview }: { preview: HookPreviewResult }) {
  const { t } = useTranslation()
  const failed = preview.error != null || (preview.exitCode != null && preview.exitCode !== 0)
  const head = preview.error
    ? preview.error
    : t('settings.hooks.previewResult', {
        defaultValue: 'exit {{code}} · {{ms}}ms',
        code: preview.exitCode ?? '—',
        ms: preview.durationMs
      })
  const body = [preview.stdout, preview.stderr].filter(Boolean).join('\n').trim()
  return (
    <div className="mt-1 overflow-hidden rounded-[var(--radius-md)] border border-border/12 bg-muted/30">
      <div
        className={cn(
          'px-2.5 py-1 font-mono text-[length:var(--code-font-size-sm)] font-medium tracking-[0.01em]',
          failed ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
        )}
      >
        {head}
      </div>
      {body ? (
        <pre className="scrollbar-subtle max-h-32 overflow-auto border-t border-border/10 px-2.5 py-1.5 font-mono text-[length:var(--code-font-size-sm)] leading-4 whitespace-pre-wrap text-foreground/70">
          {body}
        </pre>
      ) : null}
    </div>
  )
}

function HookRow({ entry }: { entry: HookEntrySummary }) {
  const { t } = useTranslation()
  const { setEnabled, trust } = useHookMutations()
  const [preview, setPreview] = useState<HookPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const needsTrust = entry.trust === 'untrusted' || entry.trust === 'modified'
  const trustMeta = TRUST_META[entry.trust]
  const active = entry.enabled && (entry.trust === 'managed' || entry.trust === 'trusted')

  const runPreview = async (): Promise<void> => {
    setPreviewing(true)
    try {
      setPreview(await hooksClient.preview(entry.key))
    } catch (error) {
      toast.error(
        errorMessage(
          error,
          t('settings.hooks.previewFailed', { defaultValue: 'Hook test failed.' })
        )
      )
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="flex w-full flex-col px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger
            render={(triggerProps) => (
              <span
                {...triggerProps}
                className={cn(
                  'mt-0.5 size-1.5 shrink-0 self-start rounded-full',
                  active ? 'bg-emerald-500' : 'bg-foreground/20'
                )}
              />
            )}
          />
          <TooltipContent side="right">
            {active
              ? t('settings.hooks.statusActive', { defaultValue: 'Active' })
              : t('settings.hooks.statusInactive', { defaultValue: 'Inactive' })}
          </TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <p
            className="truncate font-mono text-[length:var(--code-font-size-lg)] leading-snug text-foreground/85"
            title={entry.command}
          >
            {entry.command}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[0.625rem] tracking-[0.01em]">
            <span className="rounded bg-muted/50 px-1 py-px font-mono text-foreground/55">
              {entry.matcher || t('settings.hooks.matchAll', { defaultValue: '*' })}
            </span>
            <span className="text-foreground/25" aria-hidden="true">
              ·
            </span>
            <span className="text-foreground/40">{entry.source}</span>
            <span className="text-foreground/25" aria-hidden="true">
              ·
            </span>
            <span className={cn('inline-flex items-center gap-1', trustMeta.className)}>
              <span
                className={cn('size-1 rounded-full', trustMeta.dotClassName)}
                aria-hidden="true"
              />
              {t(trustMeta.labelKey, { defaultValue: trustMeta.defaultLabel })}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {needsTrust ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-amber-600 hover:text-amber-600 dark:text-amber-400"
              disabled={trust.isPending}
              onClick={() => trust.mutate({ key: entry.key, contentHash: entry.contentHash })}
            >
              <ShieldAlert className="size-3.5" />
              {t('settings.hooks.trustAction', { defaultValue: 'Trust' })}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={(triggerProps) => (
                <Button
                  {...triggerProps}
                  variant="ghost"
                  size="icon"
                  className="size-7 text-foreground/55 hover:text-foreground"
                  disabled={previewing || !active}
                  onClick={() => void runPreview()}
                  aria-label={t('settings.hooks.preview', { defaultValue: 'Test' })}
                >
                  <FlaskConical className={cn('size-3.5', previewing && 'animate-pulse')} />
                </Button>
              )}
            />
            <TooltipContent side="bottom">
              {t('settings.hooks.preview', { defaultValue: 'Test' })}
            </TooltipContent>
          </Tooltip>
          <Switch
            checked={entry.enabled}
            disabled={entry.trust === 'managed' || setEnabled.isPending}
            onCheckedChange={(checked) => setEnabled.mutate({ key: entry.key, enabled: checked })}
          />
        </div>
      </div>
      {preview ? <PreviewBlock preview={preview} /> : null}
    </div>
  )
}

function EventGroup({ event, entries }: { event: HookEvent; entries: HookEntrySummary[] }) {
  const Icon = EVENT_ICONS[event] ?? Webhook
  return (
    <section className="not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/85 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/10 px-3 py-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-muted/35 text-foreground/68 ring-1 ring-inset ring-border/15">
          <Icon className="size-3" />
        </span>
        <h2 className="flex-1 truncate text-[0.75rem] font-medium tracking-[0.01em] text-foreground/82">
          {event}
        </h2>
        <span className="text-[0.625rem] tabular-nums text-foreground/40">{entries.length}</span>
      </div>
      <div className="divide-y divide-border/8">
        {entries.map((entry) => (
          <HookRow key={entry.key} entry={entry} />
        ))}
      </div>
    </section>
  )
}

export function SettingsHooksTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { data: hooks = [], isLoading } = useHooksList()

  const byEvent = HOOK_EVENTS.map((event) => ({
    event,
    entries: hooks.filter((entry) => entry.event === event)
  })).filter((group) => group.entries.length > 0)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-1 flex-col">
      {isLoading ? (
        <div className="px-2 py-10 text-center text-[0.6875rem] tracking-[0.01em] text-foreground/52">
          {t('common.status.loading', { defaultValue: 'Loading…' })}
        </div>
      ) : byEvent.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title={t('settings.hooks.empty', { defaultValue: 'No hooks configured.' })}
          description={t('settings.hooks.emptyHint', {
            defaultValue:
              'Add a .tanzo/hooks.json in your project (or ~/.tanzo/hooks.json globally), then Reload.'
          })}
          className="flex-1"
        />
      ) : (
        <div className="space-y-3">
          {byEvent.map((group) => (
            <EventGroup key={group.event} event={group.event} entries={group.entries} />
          ))}
        </div>
      )}
    </div>
  )
}
