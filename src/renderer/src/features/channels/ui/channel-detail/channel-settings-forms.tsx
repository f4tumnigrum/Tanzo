import { useTranslation } from 'react-i18next'
import type {
  DiscordChannelSettings,
  LarkChannelSettings,
  QQChannelSettings,
  WeChatChannelSettings
} from '@shared/chat-bridge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ROW, ROW_STACK, LABEL, HINT, FIELD_LABEL, WARNING_HINT } from './field-tokens'
import { LabeledInput, SegmentedControl, ChipListEditor } from './field-primitives'

type Patch<T> = <K extends keyof T>(key: K, value: T[K]) => void

export function QQSettingsForm({
  settings,
  onChange
}: {
  settings: QQChannelSettings
  onChange: Patch<QQChannelSettings>
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <LabeledInput
        label={t('channels.qq.appId', { defaultValue: 'AppID' })}
        value={settings.appId}
        onChange={(v) => onChange('appId', v)}
        placeholder="102xxxxxx"
      />
      <div className={ROW}>
        <div className="min-w-0">
          <p className={LABEL}>{t('channels.qq.mode', { defaultValue: 'Connection mode' })}</p>
          <p className={HINT}>
            {t('channels.qq.modeHint', {
              defaultValue: 'WebSocket connects outbound (recommended for desktop).'
            })}
          </p>
        </div>
        <SegmentedControl
          options={[{ value: 'websocket' }, { value: 'webhook' }]}
          value={settings.mode}
          onChange={(m) => onChange('mode', m)}
          label={(v) =>
            t(`channels.connectionMode.${v}`, {
              defaultValue: v
            })
          }
        />
      </div>
      {settings.mode === 'webhook' ? (
        <div className={ROW_STACK}>
          <label className={FIELD_LABEL}>
            {t('channels.qq.webhookPath', { defaultValue: 'Webhook path' })}
          </label>
          <Input
            value={settings.webhookPath}
            onChange={(e) => onChange('webhookPath', e.target.value)}
            placeholder="/api/qq/webhook"
            className="h-8"
          />
          <p className={WARNING_HINT}>
            {t('channels.webhookWarning', {
              defaultValue:
                'Webhook mode needs a public HTTPS URL. The desktop app runs no public server — use WebSocket unless you front it with a tunnel.'
            })}
          </p>
        </div>
      ) : null}
      <div className={ROW}>
        <div className="min-w-0">
          <p className={LABEL}>
            {t('channels.qq.sandbox', { defaultValue: 'Sandbox environment' })}
          </p>
          <p className={HINT}>
            {t('channels.qq.sandboxHint', {
              defaultValue: 'Use QQ sandbox OpenAPI/gateway (for bots pending review).'
            })}
          </p>
        </div>
        <Switch
          checked={settings.sandbox}
          onCheckedChange={(on) => onChange('sandbox', on)}
          aria-label={t('channels.qq.sandboxToggleAria', { defaultValue: 'toggle sandbox' })}
        />
      </div>
    </>
  )
}

export function DiscordSettingsForm({
  settings,
  onChange
}: {
  settings: DiscordChannelSettings
  onChange: Patch<DiscordChannelSettings>
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <LabeledInput
        label={t('channels.discord.applicationId', { defaultValue: 'Application ID' })}
        value={settings.applicationId}
        onChange={(v) => onChange('applicationId', v)}
        placeholder={t('channels.discord.applicationIdPlaceholder', {
          defaultValue: 'Discord application id'
        })}
      />
      <LabeledInput
        label={t('channels.discord.publicKey', { defaultValue: 'Public key (required)' })}
        value={settings.publicKey}
        onChange={(v) => onChange('publicKey', v)}
        placeholder={t('channels.discord.publicKeyPlaceholder', {
          defaultValue: 'Discord public key'
        })}
        hint={t('channels.discord.publicKeyHint', {
          defaultValue:
            'Required by the Discord adapter for interaction signature checks; copy it from the Developer Portal.'
        })}
      />
      <div className={ROW_STACK}>
        <label className={FIELD_LABEL}>
          {t('channels.discord.mentionRoleIds', { defaultValue: 'Mention role ids (optional)' })}
        </label>
        <ChipListEditor
          values={settings.mentionRoleIds}
          onChange={(ids) => onChange('mentionRoleIds', ids)}
          placeholder={t('channels.discord.rolePlaceholder', {
            defaultValue: 'Role id, Enter to add'
          })}
        />
      </div>
    </>
  )
}

export function LarkSettingsForm({
  settings,
  onChange
}: {
  settings: LarkChannelSettings
  onChange: Patch<LarkChannelSettings>
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <LabeledInput
        label={t('channels.lark.appId', { defaultValue: 'App ID' })}
        value={settings.appId}
        onChange={(v) => onChange('appId', v)}
        placeholder="cli_xxxxxx"
      />
      <LabeledInput
        label={t('channels.lark.encryptKey', { defaultValue: 'Encrypt key (optional)' })}
        value={settings.encryptKey}
        onChange={(v) => onChange('encryptKey', v)}
        placeholder={t('channels.lark.encryptKeyPlaceholder', {
          defaultValue: 'Only if event encryption is enabled'
        })}
      />
      <div className={ROW}>
        <span className={LABEL}>{t('channels.lark.domain', { defaultValue: 'Domain' })}</span>
        <SegmentedControl
          options={[{ value: 'feishu' as const }, { value: 'lark' as const }]}
          value={settings.domain}
          onChange={(d) => onChange('domain', d)}
          label={(v) =>
            t(`channels.lark.domainOption.${v}`, {
              defaultValue: v === 'feishu' ? 'Feishu' : 'Lark'
            })
          }
        />
      </div>
      <div className={ROW}>
        <div className="min-w-0">
          <p className={LABEL}>{t('channels.lark.mode', { defaultValue: 'Incoming transport' })}</p>
          <p className={HINT}>
            {t('channels.lark.modeHint', {
              defaultValue: 'ws = long-connection (recommended for desktop); webhook needs a URL.'
            })}
          </p>
        </div>
        <SegmentedControl
          options={[{ value: 'ws' as const }, { value: 'webhook' as const }]}
          value={settings.mode}
          onChange={(m) => onChange('mode', m)}
          label={(v) =>
            t(`channels.lark.modeOption.${v}`, {
              defaultValue: v
            })
          }
        />
      </div>
    </>
  )
}

export function WeChatSettingsForm({
  settings,
  onChange
}: {
  settings: WeChatChannelSettings
  onChange: Patch<WeChatChannelSettings>
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <LabeledInput
        label={t('channels.wechat.appId', { defaultValue: 'AppID' })}
        value={settings.appId}
        onChange={(v) => onChange('appId', v)}
        placeholder="wx_xxxxxx"
      />
      <LabeledInput
        label={t('channels.wechat.token', { defaultValue: 'Verification token' })}
        value={settings.token}
        onChange={(v) => onChange('token', v)}
        placeholder={t('channels.wechat.tokenPlaceholder', {
          defaultValue: 'Plain token from the WeChat console'
        })}
        hint={t('channels.wechat.tokenHint', {
          defaultValue: 'The plaintext token (not the secret AES key set below).'
        })}
      />
      <div className={ROW}>
        <span className={LABEL}>{t('channels.wechat.env', { defaultValue: 'Environment' })}</span>
        <SegmentedControl
          options={[{ value: 'online' as const }, { value: 'debug' as const }]}
          value={settings.env}
          onChange={(e) => onChange('env', e)}
          label={(v) =>
            t(`channels.wechat.envOption.${v}`, {
              defaultValue: v
            })
          }
        />
      </div>
      <div className={ROW_STACK}>
        <p className={WARNING_HINT}>
          {t('channels.wechat.transportNote', {
            defaultValue:
              'WeChat Dialog Platform delivers events by webhook callback, which needs a public HTTPS URL reachable by WeChat.'
          })}
        </p>
      </div>
    </>
  )
}
