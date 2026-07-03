import { useCallback } from 'react'
import { Brain, Globe, Palette, Sun, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/components/theme/theme-provider'
import { SUPPORTED_LANGUAGES } from '@/i18n'
import { cn } from '@/lib/utils'
import { patchPreferences, usePreferences } from '@/common/preferences'
import { useCustomThemes } from '@/common/theme/custom-themes'
import { colorThemes } from '@/common/theme/presets'
import { useThemeSettings } from '@/common/theme/store'
import type { ThemeMode } from '@shared/preferences'
import { SectionCard } from '../shared/settings-primitives'
import { ThemeImportRow } from './theme-import-row'
import { ThemeOptionRow } from './theme-option-row'
import { ColorThemePreview, ModePreview } from './theme-previews'

function languageOptionKey(value: string): string {
  return value === 'zh-CN' ? 'zhCN' : value
}

export function LanguageSettingsSection() {
  const { t, i18n } = useTranslation()
  const language = usePreferences().language ?? (i18n.language as 'en' | 'zh-CN')

  return (
    <SectionCard
      icon={<Globe className="size-3" />}
      title={t('settings.language.title')}
      description={t('settings.language.description')}
    >
      {SUPPORTED_LANGUAGES.map(({ value, label }) => {
        const key = languageOptionKey(value)
        return (
          <ThemeOptionRow
            key={value}
            label={t(`settings.language.options.${key}.label`, { defaultValue: label })}
            description={t(`settings.language.options.${key}.description`)}
            selected={language === value}
            onClick={() => void patchPreferences({ language: value })}
            preview={
              <div className="flex h-full w-full items-center justify-center text-[0.8125rem] font-medium text-foreground/82">
                {value.toLowerCase().startsWith('zh') ? '中' : 'Aa'}
              </div>
            }
          />
        )
      })}
    </SectionCard>
  )
}

export function AppearanceModeSection() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  const modeOptions: Array<{ value: ThemeMode; label: string; description: string }> = [
    {
      value: 'light',
      label: t('settings.theme.appearance.mode.light.label'),
      description: t('settings.theme.appearance.mode.light.description')
    },
    {
      value: 'dark',
      label: t('settings.theme.appearance.mode.dark.label'),
      description: t('settings.theme.appearance.mode.dark.description')
    },
    {
      value: 'system',
      label: t('settings.theme.appearance.mode.system.label'),
      description: t('settings.theme.appearance.mode.system.description')
    }
  ]

  return (
    <SectionCard
      icon={<Sun className="size-3" />}
      title={t('settings.theme.appearance.title')}
      description={t('settings.theme.appearance.description')}
    >
      {modeOptions.map((option) => (
        <ThemeOptionRow
          key={option.value}
          label={option.label}
          description={option.description}
          selected={theme === option.value}
          onClick={() => setTheme(option.value)}
          preview={<ModePreview mode={option.value} />}
          previewClassName="w-20"
        />
      ))}
    </SectionCard>
  )
}

export function ReasoningSection() {
  const { t } = useTranslation()
  const preferences = usePreferences()

  return (
    <SectionCard
      icon={<Brain className="size-3" />}
      title={t('settings.theme.reasoning.title', { defaultValue: 'Reasoning Tags' })}
      description={t('settings.theme.reasoning.description', {
        defaultValue: 'Control whether thinking tags start expanded in chat messages.'
      })}
    >
      <div className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5">
        <div className="min-w-0">
          <div className="text-[0.8125rem] text-foreground/82">
            {t('settings.theme.reasoning.expand.label', {
              defaultValue: 'Expand reasoning tags by default'
            })}
          </div>
          <p className="text-[0.6875rem] leading-4 text-foreground/52">
            {t('settings.theme.reasoning.expand.description', {
              defaultValue: 'Applies to thinking and reasoning XML tags.'
            })}
          </p>
        </div>
        <Switch
          checked={preferences.reasoningExpandedByDefault}
          onCheckedChange={(checked) =>
            void patchPreferences({ reasoningExpandedByDefault: checked })
          }
        />
      </div>
    </SectionCard>
  )
}

export function ColorThemeSection() {
  const { t } = useTranslation()
  const { colorThemeId, setColorThemeId } = useThemeSettings()
  const { themes: customThemes, removeTheme } = useCustomThemes()

  const handleRemoveCustomTheme = useCallback((id: string) => void removeTheme(id), [removeTheme])

  return (
    <SectionCard
      icon={<Palette className="size-3" />}
      title={t('settings.theme.colors.title')}
      description={t('settings.theme.colors.description')}
    >
      {colorThemes.map((option) => (
        <ThemeOptionRow
          key={option.id}
          label={t(`settings.theme.colors.options.${option.id}.label`, {
            defaultValue: option.name
          })}
          description={t(`settings.theme.colors.options.${option.id}.description`, {
            defaultValue: option.description
          })}
          selected={colorThemeId === option.id}
          onClick={() => void setColorThemeId(option.id)}
          preview={<ColorThemePreview theme={option} />}
          previewClassName="w-20"
        />
      ))}
      {customThemes.map((option) => (
        <div key={option.id} className="group/custom relative">
          <ThemeOptionRow
            label={option.name}
            description={option.description}
            selected={colorThemeId === option.id}
            onClick={() => void setColorThemeId(option.id)}
            preview={<ColorThemePreview theme={option} />}
            previewClassName="w-20"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => handleRemoveCustomTheme(option.id)}
            title={t('settings.theme.colors.actions.remove', { defaultValue: 'Remove' })}
            className={cn(
              'absolute right-8 top-1/2 -translate-y-1/2 rounded-full text-foreground/40',
              'opacity-0 transition-opacity hover:bg-red-500/8 hover:text-red-500/78',
              'group-hover/custom:opacity-100'
            )}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <ThemeImportRow />
    </SectionCard>
  )
}

