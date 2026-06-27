import type { ColorThemeDefinition, ColorThemeId, ThemeColors, ThemeOverrides } from './types'
import { addCustomTheme, removeCustomTheme, usePreferences } from '@/common/preferences'
import { TanzoIntegrationError } from '@shared/errors'
import i18n from '@/i18n'

const THEME_COLOR_KEYS = new Set<string>([
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5'
])

const OVERRIDE_KEYS = new Set<string>([
  'radius',
  'spacing',
  'tracking-normal',
  'font-sans',
  'font-serif',
  'font-mono',
  'shadow-2xs',
  'shadow-xs',
  'shadow-sm',
  'shadow',
  'shadow-md',
  'shadow-lg',
  'shadow-xl',
  'shadow-2xl'
])

function normalizeQuotes(value: string): string {
  return value.replace(/[“”"]/g, "'")
}

function splitVars(vars: Record<string, string>): {
  colors: Partial<ThemeColors>
  overrides: Partial<ThemeOverrides>
  colorCount: number
} {
  const colors: Record<string, string> = {}
  const overrides: Record<string, string> = {}
  let colorCount = 0
  for (const [key, raw] of Object.entries(vars)) {
    if (typeof raw !== 'string') continue
    const normalized = normalizeQuotes(raw)
    if (THEME_COLOR_KEYS.has(key)) {
      colors[key] = normalized
      colorCount += 1
    } else if (OVERRIDE_KEYS.has(key)) overrides[key] = normalized
  }
  return {
    colors: colors as Partial<ThemeColors>,
    overrides: overrides as Partial<ThemeOverrides>,
    colorCount
  }
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function extractUrl(input: string): string {
  const match = input.match(/https?:\/\/[^\s]+/)
  return match ? match[0] : input.trim()
}

function asRecord(value: unknown): Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {}
}

interface TweakcnResponse {
  name?: string
  description?: string
  cssVars?: {
    theme?: Record<string, string>
    light?: Record<string, string>
    dark?: Record<string, string>
  }
}

export async function importTweakcnTheme(input: string): Promise<ColorThemeDefinition> {
  const url = extractUrl(input)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TanzoIntegrationError(
      'THEME_IMPORT_INVALID',
      i18n.t('settings.theme.colors.import.errors.invalidUrl')
    )
  }
  if (parsed.protocol !== 'https:') {
    throw new TanzoIntegrationError(
      'THEME_IMPORT_INVALID',
      i18n.t('settings.theme.colors.import.errors.httpsRequired')
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let response: Response
  let text: string
  try {
    response = await fetch(parsed.toString(), { signal: controller.signal })
    if (!response.ok) {
      throw new TanzoIntegrationError(
        'THEME_IMPORT_FETCH_FAILED',
        i18n.t('settings.theme.colors.import.errors.fetchFailed', { status: response.status })
      )
    }
    text = await response.text()
  } finally {
    clearTimeout(timer)
  }
  if (text.length > 1_000_000) {
    throw new TanzoIntegrationError(
      'THEME_IMPORT_INVALID',
      i18n.t('settings.theme.colors.import.errors.tooLarge')
    )
  }

  let data: TweakcnResponse
  try {
    data = JSON.parse(text) as TweakcnResponse
  } catch {
    throw new TanzoIntegrationError(
      'THEME_IMPORT_INVALID',
      i18n.t('settings.theme.colors.import.errors.invalidJson')
    )
  }
  const name =
    typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Theme'
  const slug = toSlug(name) || 'theme'
  const id: ColorThemeId = `custom-${slug}`
  const cssVars = typeof data.cssVars === 'object' && data.cssVars !== null ? data.cssVars : {}

  const lightRaw = { ...asRecord(cssVars.theme), ...asRecord(cssVars.light) }
  const darkRaw = { ...asRecord(cssVars.theme), ...asRecord(cssVars.dark) }

  const light = splitVars(lightRaw)
  const dark = splitVars(darkRaw)
  if (light.colorCount === 0 && dark.colorCount === 0) {
    throw new TanzoIntegrationError(
      'THEME_IMPORT_INVALID',
      i18n.t('settings.theme.colors.import.errors.noVariables')
    )
  }

  const fallbackLight = 'oklch(0.9900 0 0)'
  const fallbackDark = 'oklch(0.1500 0 0)'
  for (const key of THEME_COLOR_KEYS) {
    if (!(key in light.colors)) (light.colors as Record<string, string>)[key] = fallbackLight
    if (!(key in dark.colors)) (dark.colors as Record<string, string>)[key] = fallbackDark
  }

  const hasLightOverrides = Object.keys(light.overrides).length > 0
  const hasDarkOverrides = Object.keys(dark.overrides).length > 0

  return {
    id,
    name,
    description: data.description || name,
    light: light.colors as ThemeColors,
    dark: dark.colors as ThemeColors,
    ...(hasLightOverrides ? { lightOverrides: light.overrides as ThemeOverrides } : {}),
    ...(hasDarkOverrides ? { darkOverrides: dark.overrides as ThemeOverrides } : {})
  }
}

export function useCustomThemes() {
  const themes = usePreferences().customThemes
  return { themes, addTheme: addCustomTheme, removeTheme: removeCustomTheme }
}
