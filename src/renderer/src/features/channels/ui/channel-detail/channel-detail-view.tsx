import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ExternalLink,
  Loader2,
  PlugZap,
  ShieldCheck,
  Bot,
  AlertCircle,
  CheckCircle2,
  Save,
  X
} from 'lucide-react'
import {
  CHANNEL_META,
  DEFAULT_CHAT_BRIDGE_CONFIG,
  type ChannelConfig,
  type ChannelId,
  type ChannelPermissionMode
} from '@shared/chat-bridge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { EntityDetailScaffold } from '@/components/layout/page-scaffold'
import { SectionCard } from '@/features/settings/ui/shared/settings-primitives'
import {
  useChatBridgeConfig,
  useChatBridgeStatus,
  useChatBridgeMutations
} from '@/features/chat-bridge/model/queries'
import { CHANNEL_PRESENTATION } from '../../model/channel-presentation'
import { openChannelConsole } from '../../model/channel-links'
import { useChannelDetailStore } from '../../model/store'
import { ROW, ROW_STACK, LABEL, HINT, FIELD_LABEL, SECTION_DISABLED } from './field-tokens'
import {
  ChannelStatusBadge,
  SegmentedControl,
  ChipListEditor,
  SecretField
} from './field-primitives'
import { FloatingSaveBar } from '@/features/providers/ui/provider-detail/floating-save-bar'
import {
  QQSettingsForm,
  DiscordSettingsForm,
  LarkSettingsForm,
  WeChatSettingsForm
} from './channel-settings-forms'

export function ChannelDetailView({ channelId }: { channelId: ChannelId }): React.JSX.Element {
  const { t } = useTranslation()
  const setSelected = useChannelDetailStore((s) => s.setSelectedChannelId)
  const configQuery = useChatBridgeConfig()
  const statusQuery = useChatBridgeStatus()
  const { saveConfig, setSecret, connect, disconnect, testConnection } = useChatBridgeMutations()

  const meta = CHANNEL_META[channelId]
  const presentation = CHANNEL_PRESENTATION[channelId]
  const serverConfig = configQuery.data?.channels[channelId]

  const [form, setForm] = useState<ChannelConfig>(DEFAULT_CHAT_BRIDGE_CONFIG.channels[channelId])
  const [secretDraft, setSecretDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // Adopt server config without an effect (React "adjust state while rendering"), guarded by
  // identity so each distinct payload is adopted once and user edits win.
  const [syncedFrom, setSyncedFrom] = useState<ChannelConfig | null>(null)
  if (serverConfig && !dirty && syncedFrom !== serverConfig) {
    setSyncedFrom(serverConfig)
    setForm(serverConfig)
  }

  const status = statusQuery.data?.channels[channelId]
  const secretConfigured = status?.secretConfigured ?? false

  const update = <K extends keyof ChannelConfig>(key: K, value: ChannelConfig[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }
  // Patch a channel-specific settings field. Typed loosely here; each form supplies the exact
  // key/value pair matching its own settings shape.
  const patchSettings = (key: string, value: unknown): void => {
    setForm((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }))
    setDirty(true)
  }

  const testResult = testConnection.data
  const testMessage = useMemo(() => {
    if (testConnection.isPending) return t('channels.test.running', { defaultValue: 'Testing…' })
    if (!testResult) return null
    if (testResult.ok) {
      return testResult.botId
        ? t('channels.test.okWithBot', {
            defaultValue: 'Reachable · bot {{id}}',
            id: testResult.botId
          })
        : t('channels.test.ok', { defaultValue: 'Reachable' })
    }
    return t('channels.test.failed', {
      defaultValue: 'Failed: {{msg}}',
      msg: testResult.message ?? t('channels.test.unknownError', { defaultValue: 'unknown error' })
    })
  }, [testConnection.isPending, testResult, t])

  const persistFormAndSecret = async (): Promise<void> => {
    if (dirty) {
      await saveConfig.mutateAsync(form)
      setDirty(false)
    }
    if (secretDraft.length > 0) {
      await setSecret.mutateAsync({ channelId, secret: secretDraft })
      setSecretDraft('')
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaveStatus('saving')
    try {
      await persistFormAndSecret()
      setSaveStatus('success')
    } catch {
      setSaveStatus('error')
    }
  }

  const handleCancel = (): void => {
    if (serverConfig) setForm(serverConfig)
    setSecretDraft('')
    setDirty(false)
    setSaveStatus('idle')
  }

  const handleTestConnection = async (): Promise<void> => {
    await persistFormAndSecret()
    await testConnection.mutateAsync(channelId)
  }

  const handleConnect = async (): Promise<void> => {
    await persistFormAndSecret()
    await connect.mutateAsync(channelId)
  }

  const channelName = t(`channels.name.${channelId}`, { defaultValue: meta.name })
  const hasPendingSecret = secretDraft.length > 0
  const saveOrSecretPending = saveConfig.isPending || setSecret.isPending
  const nothingToSave = !dirty && !hasPendingSecret
  // Count pending edits for the floating save bar: changed top-level config keys + a pending secret.
  const changeCount = useMemo(() => {
    let n = hasPendingSecret ? 1 : 0
    if (serverConfig) {
      for (const key of Object.keys(form) as (keyof ChannelConfig)[]) {
        if (JSON.stringify(form[key]) !== JSON.stringify(serverConfig[key])) n += 1
      }
    } else if (dirty) {
      n += 1
    }
    return n
  }, [form, serverConfig, dirty, hasPendingSecret])

  // Auto-reset the transient success/error state back to idle, mirroring the provider save bar.
  useEffect(() => {
    if (saveStatus !== 'success' && saveStatus !== 'error') return
    const timer = setTimeout(() => setSaveStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [saveStatus])
  const handleOpenConsole = (): void => {
    const larkDomain =
      channelId === 'lark'
        ? (form.settings as import('@shared/chat-bridge').LarkChannelSettings).domain
        : undefined
    openChannelConsole(channelId, larkDomain ? { larkDomain } : {})
  }

  return (
    <EntityDetailScaffold
      title={channelName}
      onBack={() => setSelected(null)}
      actions={
        <Button type="button" variant="toolbar" size="toolbar" onClick={handleOpenConsole}>
          <span>{t('channels.actions.openConsole', { defaultValue: 'Open console' })}</span>
          <ExternalLink className="size-3" />
        </Button>
      }
    >
      <div className="prose-none mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 pt-2">
        {/* Overview: channel switch + live status */}
        <SectionCard
          icon={
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-[var(--radius-md)]',
                presentation.accent
              )}
            >
              {presentation.icon}
            </span>
          }
          title={channelName}
          description={t(`channels.description.${channelId}`, {
            defaultValue:
              meta.transport === 'outbound'
                ? 'Outbound connection — works from the desktop app with no public server.'
                : 'Webhook channel — needs a public HTTPS URL the platform can reach.'
          })}
          action={status ? <ChannelStatusBadge state={status.state} /> : null}
        >
          <div className={ROW}>
            <div className="min-w-0">
              <p className={LABEL}>{t('channels.enabled', { defaultValue: 'Enable channel' })}</p>
              <p className={HINT}>
                {t('channels.enabledHint', {
                  defaultValue:
                    'Master switch. Requires credentials and a stored secret to connect.'
                })}
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(on) => update('enabled', on)}
              aria-label={t('channels.enabledToggleAria', { defaultValue: 'enable channel' })}
            />
          </div>
          {status?.state === 'error' && status.lastError ? (
            <div className="flex items-start gap-1.5 px-3 py-2 text-[0.625rem] leading-4 text-destructive">
              <AlertCircle className="mt-px size-3 shrink-0" />
              <span className="min-w-0 break-words">{status.lastError}</span>
            </div>
          ) : null}
          {status?.botId || status?.state === 'connected' ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              {status?.botId ? (
                <span className={cn('inline-flex items-center gap-1.5', HINT)}>
                  <Bot className="size-3 text-foreground/40" />
                  <code className="font-mono text-foreground/70">{status.botId}</code>
                </span>
              ) : null}
              <span className={HINT}>
                {t('channels.activeConversations', {
                  defaultValue: '{{n}} active',
                  n: status?.activeConversations ?? 0
                })}
              </span>
              {status?.lastActivityAt ? (
                <span className={HINT}>
                  {t('channels.lastActivity', {
                    defaultValue: 'Last activity {{time}}',
                    time: new Date(status.lastActivityAt).toLocaleTimeString()
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        {/* Credentials + connection (channel-specific). Dimmed while the channel is off. */}
        <div className={cn(!form.enabled && SECTION_DISABLED)} aria-disabled={!form.enabled}>
          <SectionCard
            icon={<PlugZap className="size-3" />}
            title={t('channels.credentials.title', { defaultValue: 'Credentials & connection' })}
            description={t(`channels.credentials.description.${channelId}`, {
              defaultValue: 'Connection settings for this channel.'
            })}
          >
            {channelId === 'qq' ? (
              <QQSettingsForm
                settings={form.settings as import('@shared/chat-bridge').QQChannelSettings}
                onChange={(k, v) => patchSettings(k as string, v)}
              />
            ) : channelId === 'discord' ? (
              <DiscordSettingsForm
                settings={form.settings as import('@shared/chat-bridge').DiscordChannelSettings}
                onChange={(k, v) => patchSettings(k as string, v)}
              />
            ) : channelId === 'lark' ? (
              <LarkSettingsForm
                settings={form.settings as import('@shared/chat-bridge').LarkChannelSettings}
                onChange={(k, v) => patchSettings(k as string, v)}
              />
            ) : (
              <WeChatSettingsForm
                settings={form.settings as import('@shared/chat-bridge').WeChatChannelSettings}
                onChange={(k, v) => patchSettings(k as string, v)}
              />
            )}

            <SecretField
              label={t(`channels.secretLabel.${channelId}`, { defaultValue: meta.secretLabel })}
              configured={secretConfigured}
              draft={secretDraft}
              onDraftChange={setSecretDraft}
              onSave={async () => {
                await setSecret.mutateAsync({ channelId, secret: secretDraft })
                setSecretDraft('')
              }}
              onClear={() => void setSecret.mutateAsync({ channelId, secret: '' })}
              saving={setSecret.isPending}
              placeholder={t(`channels.secretLabel.${channelId}`, {
                defaultValue: meta.secretLabel
              })}
              hint={t('channels.secret.hint', {
                defaultValue: 'Stored encrypted via the OS secure store. Never displayed again.'
              })}
            />

            <div className={cn(ROW, 'justify-start gap-2')}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleTestConnection()}
                disabled={testConnection.isPending || saveOrSecretPending}
              >
                {testConnection.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('channels.test.button', { defaultValue: 'Test connection' })}
              </Button>
              {testMessage ? (
                <span
                  className={cn(
                    'text-[0.6875rem]',
                    testResult?.ok === false ? 'text-destructive' : 'text-foreground/55'
                  )}
                >
                  {testMessage}
                </span>
              ) : null}
            </div>
          </SectionCard>
        </div>

        {/* Safety: allowlist + permission mode (shared). Dimmed while the channel is off. */}
        <div className={cn(!form.enabled && SECTION_DISABLED)} aria-disabled={!form.enabled}>
          <SectionCard
            icon={<ShieldCheck className="size-3" />}
            title={t('channels.safety.title', { defaultValue: 'Access & safety' })}
            description={t('channels.safety.description', {
              defaultValue: 'Only allow-listed groups/users can trigger the agent. Empty = nobody.'
            })}
          >
            <div className={ROW_STACK}>
              <label className={FIELD_LABEL}>
                {t('channels.safety.groups', { defaultValue: 'Allowed group / channel ids' })}
              </label>
              <ChipListEditor
                values={form.allowlist.groups}
                onChange={(groups) => update('allowlist', { ...form.allowlist, groups })}
                placeholder={t('channels.safety.groupPlaceholder', {
                  defaultValue: 'Group id, Enter to add'
                })}
              />
            </div>
            <div className={ROW_STACK}>
              <label className={FIELD_LABEL}>
                {t('channels.safety.users', { defaultValue: 'Allowed user ids' })}
              </label>
              <ChipListEditor
                values={form.allowlist.users}
                onChange={(users) => update('allowlist', { ...form.allowlist, users })}
                placeholder={t('channels.safety.userPlaceholder', {
                  defaultValue: 'User id, Enter to add'
                })}
              />
            </div>
            {status?.lastDeniedThreadId ? (
              <div className={cn(ROW_STACK, 'rounded-[var(--radius-md)] bg-muted/35 px-3 py-2')}>
                <div>
                  <p className={LABEL}>
                    {t('channels.safety.lastDenied.title', { defaultValue: 'Last blocked source' })}
                  </p>
                  <p className={HINT}>
                    {t('channels.safety.lastDenied.description', {
                      defaultValue:
                        'The bridge received a message, but the allowlist denied it. Add the matching id above and try again.'
                    })}
                  </p>
                </div>
                <div className="space-y-1 text-[0.625rem] leading-4">
                  <div className="min-w-0">
                    <span className="text-foreground/50">
                      {t('channels.safety.lastDenied.threadId', { defaultValue: 'Thread ID' })}
                      :{' '}
                    </span>
                    <code className="break-all font-mono text-foreground/80">
                      {status.lastDeniedThreadId}
                    </code>
                  </div>
                  <div className="min-w-0">
                    <span className="text-foreground/50">
                      {t('channels.safety.lastDenied.authorId', { defaultValue: 'Author ID' })}
                      :{' '}
                    </span>
                    <code className="break-all font-mono text-foreground/80">
                      {status.lastDeniedAuthorId ||
                        t('channels.safety.lastDenied.missingAuthor', {
                          defaultValue: '(missing)'
                        })}
                    </code>
                  </div>
                </div>
              </div>
            ) : null}
            <div className={ROW}>
              <div className="min-w-0">
                <p className={LABEL}>
                  {t('channels.safety.permissionMode', { defaultValue: 'Permission mode' })}
                </p>
                <p className={HINT}>
                  {t('channels.safety.permissionModeHint', {
                    defaultValue:
                      'default: ask in chat · plan: block writes · yolo: auto-approve non-destructive.'
                  })}
                </p>
              </div>
              <SegmentedControl<ChannelPermissionMode>
                options={[{ value: 'default' }, { value: 'plan' }, { value: 'yolo' }]}
                value={form.permissionMode}
                onChange={(mode) => update('permissionMode', mode)}
                label={(v) => t(`channels.safety.mode.${v}`, { defaultValue: v })}
              />
            </div>
            <div className={ROW}>
              <div className="min-w-0">
                <p className={LABEL}>
                  {t('channels.safety.surfaceApprovals', {
                    defaultValue: 'Surface approvals in chat'
                  })}
                </p>
                <p className={HINT}>
                  {t('channels.safety.surfaceApprovalsHint', {
                    defaultValue: 'When off, any operation needing approval is auto-denied.'
                  })}
                </p>
              </div>
              <Switch
                checked={form.surfaceApprovals}
                onCheckedChange={(on) => update('surfaceApprovals', on)}
                aria-label={t('channels.safety.surfaceApprovalsAria', {
                  defaultValue: 'surface approvals'
                })}
              />
            </div>
          </SectionCard>
        </div>

        {/* Bot identity + connection controls */}
        <SectionCard
          icon={<Bot className="size-3" />}
          title={t('channels.bot.title', { defaultValue: 'Bot & actions' })}
          description={t('channels.bot.description', {
            defaultValue: 'Display name and connection controls.'
          })}
        >
          <div className={ROW_STACK}>
            <label className={FIELD_LABEL}>
              {t('channels.bot.name', { defaultValue: 'Bot name' })}
            </label>
            <Input
              value={form.botUserName}
              onChange={(e) => update('botUserName', e.target.value)}
              className="h-8"
            />
          </div>
          <div className={cn(ROW, 'flex-wrap justify-start gap-2')}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={connect.isPending || disconnect.isPending || saveOrSecretPending}
            >
              {connect.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('channels.actions.connect', { defaultValue: 'Connect' })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void disconnect.mutateAsync(channelId)}
              disabled={disconnect.isPending || connect.isPending}
            >
              {disconnect.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('channels.actions.disconnect', { defaultValue: 'Disconnect' })}
            </Button>
          </div>
        </SectionCard>

        {/* Floating save bar — matches the provider/model detail page. */}
        <FloatingSaveBar visible={!nothingToSave} changeCount={changeCount} status={saveStatus}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={saveOrSecretPending}
            className="h-8 rounded-xl px-3 text-xs"
          >
            <X className="mr-1 size-3.5" />
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saveOrSecretPending || nothingToSave}
            className="h-8 rounded-xl px-3 text-xs"
          >
            {saveOrSecretPending || saveStatus === 'saving' ? (
              <Spinner className="mr-1 size-3.5" />
            ) : saveStatus === 'success' ? (
              <CheckCircle2 className="mr-1 size-3.5" />
            ) : (
              <Save className="mr-1 size-3.5" />
            )}
            {saveStatus === 'success'
              ? t('common.actions.saved', { defaultValue: 'Saved' })
              : t('common.actions.save', { defaultValue: 'Save' })}
          </Button>
        </FloatingSaveBar>
      </div>
    </EntityDetailScaffold>
  )
}
