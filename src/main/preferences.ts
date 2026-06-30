import { app, BrowserWindow, ipcMain, nativeTheme, type IpcMain } from 'electron'
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WALLPAPER,
  PET_SCALE_DEFAULT,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  PREFERENCES_CHANNELS,
  WALLPAPER_BLUR_MAX,
  WALLPAPER_OPACITY_MAX,
  WALLPAPER_OPACITY_MIN,
  WALLPAPER_OVERLAY_MAX,
  type ColorThemeDefinition,
  type ColorThemeId,
  type DensityPresetId,
  type FontSizePresetId,
  type Language,
  type PetPosition,
  type PreferencesPatch,
  type RadiusPresetId,
  type ThemeColors,
  type ThemeMode,
  type ThemeOverrides,
  type UserPreferences,
  type WallpaperOverlay,
  type WallpaperSettings
} from '@shared/preferences'
import { createLogger } from './logger'
import { TOOL_CATALOG_IDS } from '@shared/tool-catalog'

const log = createLogger('preferences')

const FILE_NAME = 'preferences.json'
const VALID_THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']
const VALID_RADIUS_PRESETS: readonly RadiusPresetId[] = ['sharp', 'balanced', 'soft', 'pill']
const VALID_DENSITY_PRESETS: readonly DensityPresetId[] = ['compact', 'comfortable', 'spacious']
const VALID_FONT_SIZE_PRESETS: readonly FontSizePresetId[] = ['small', 'default', 'large']
const VALID_LANGUAGES: readonly Language[] = ['en', 'zh-CN']
const VALID_WALLPAPER_OVERLAYS: readonly WallpaperOverlay[] = ['none', 'dark', 'light']
const THEME_COLOR_KEYS: readonly (keyof ThemeColors)[] = [
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
]
const THEME_OVERRIDE_KEYS: readonly (keyof ThemeOverrides)[] = [
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
]

let cached: UserPreferences | null = null
let storagePath: string | null = null
const changeListeners = new Set<(preferences: UserPreferences) => void>()

function path(): string {
  if (!storagePath) storagePath = join(app.getPath('userData'), FILE_NAME)
  return storagePath
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function normalizeThemeColors(value: unknown): ThemeColors | null {
  if (!isRecord(value)) return null
  const normalized: Partial<Record<keyof ThemeColors, string>> = {}
  for (const key of THEME_COLOR_KEYS) {
    const color = value[key]
    if (typeof color !== 'string') return null
    normalized[key] = color
  }
  return normalized as ThemeColors
}

function normalizeThemeOverrides(value: unknown): ThemeOverrides | undefined {
  if (!isRecord(value)) return undefined
  const normalized: Partial<Record<keyof ThemeOverrides, string>> = {}
  for (const key of THEME_OVERRIDE_KEYS) {
    const override = value[key]
    if (typeof override === 'string') normalized[key] = override
  }
  return Object.keys(normalized).length > 0 ? (normalized as ThemeOverrides) : undefined
}

function normalizeCustomTheme(value: unknown): ColorThemeDefinition | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!id || !name) return null

  const light = normalizeThemeColors(value.light)
  const dark = normalizeThemeColors(value.dark)
  if (!light || !dark) return null
  const lightOverrides = normalizeThemeOverrides(value.lightOverrides)
  const darkOverrides = normalizeThemeOverrides(value.darkOverrides)

  return {
    id,
    name,
    description: nonEmptyString(value.description, name),
    light,
    dark,
    ...(lightOverrides ? { lightOverrides } : {}),
    ...(darkOverrides ? { darkOverrides } : {})
  }
}

function normalizeCustomThemes(value: unknown): ColorThemeDefinition[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<ColorThemeId, ColorThemeDefinition>()
  for (const item of value) {
    const theme = normalizeCustomTheme(item)
    if (theme) byId.set(theme.id, theme)
  }
  return [...byId.values()]
}

function normalizePetPosition(value: unknown): PetPosition | null {
  if (!isRecord(value)) return null
  const { x, y } = value
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

function normalizePetScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PET_SCALE_DEFAULT
  return Math.min(Math.max(value, PET_SCALE_MIN), PET_SCALE_MAX)
}

function normalizeDisabledTools(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  // Keep only known tool ids so stale ids from older versions are dropped.
  const known = new Set(TOOL_CATALOG_IDS)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && known.has(item) && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function normalizeWallpaper(value: unknown): WallpaperSettings {
  const parsed = isRecord(value) ? value : {}
  const assetPath =
    typeof parsed.assetPath === 'string' && parsed.assetPath.trim().length > 0
      ? parsed.assetPath
      : null
  return {
    assetPath,
    opacity: clampNumber(
      parsed.opacity,
      WALLPAPER_OPACITY_MIN,
      WALLPAPER_OPACITY_MAX,
      DEFAULT_WALLPAPER.opacity
    ),
    blur: clampNumber(parsed.blur, 0, WALLPAPER_BLUR_MAX, DEFAULT_WALLPAPER.blur),
    overlay: isOneOf(parsed.overlay, VALID_WALLPAPER_OVERLAYS)
      ? parsed.overlay
      : DEFAULT_WALLPAPER.overlay,
    overlayStrength: clampNumber(
      parsed.overlayStrength,
      0,
      WALLPAPER_OVERLAY_MAX,
      DEFAULT_WALLPAPER.overlayStrength
    )
  }
}

function normalizePreferences(value: unknown): UserPreferences {
  const parsed = isRecord(value) ? value : {}
  return {
    themeMode: isOneOf(parsed.themeMode, VALID_THEME_MODES)
      ? parsed.themeMode
      : DEFAULT_PREFERENCES.themeMode,
    colorThemeId: nonEmptyString(parsed.colorThemeId, DEFAULT_PREFERENCES.colorThemeId),
    radiusPresetId: isOneOf(parsed.radiusPresetId, VALID_RADIUS_PRESETS)
      ? parsed.radiusPresetId
      : DEFAULT_PREFERENCES.radiusPresetId,
    densityPresetId: isOneOf(parsed.densityPresetId, VALID_DENSITY_PRESETS)
      ? parsed.densityPresetId
      : DEFAULT_PREFERENCES.densityPresetId,
    fontSizePresetId: isOneOf(parsed.fontSizePresetId, VALID_FONT_SIZE_PRESETS)
      ? parsed.fontSizePresetId
      : DEFAULT_PREFERENCES.fontSizePresetId,
    language:
      parsed.language === null
        ? null
        : isOneOf(parsed.language, VALID_LANGUAGES)
          ? parsed.language
          : DEFAULT_PREFERENCES.language,
    customThemes: normalizeCustomThemes(parsed.customThemes),
    reasoningExpandedByDefault:
      typeof parsed.reasoningExpandedByDefault === 'boolean'
        ? parsed.reasoningExpandedByDefault
        : DEFAULT_PREFERENCES.reasoningExpandedByDefault,
    petEnabled:
      typeof parsed.petEnabled === 'boolean' ? parsed.petEnabled : DEFAULT_PREFERENCES.petEnabled,
    petId: typeof parsed.petId === 'string' && parsed.petId.trim().length > 0 ? parsed.petId : null,
    petPosition: normalizePetPosition(parsed.petPosition),
    petScale: normalizePetScale(parsed.petScale),
    wallpaper: normalizeWallpaper(parsed.wallpaper),
    disabledTools: normalizeDisabledTools(parsed.disabledTools)
  }
}

function read(): UserPreferences {
  try {
    const raw = readFileSync(path(), 'utf-8')
    return normalizePreferences(JSON.parse(raw))
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      log.error('failed to read preferences; using defaults', error)
    }
    return normalizePreferences(DEFAULT_PREFERENCES)
  }
}

function write(value: UserPreferences): void {
  const target = path()
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
    renameSync(tmp, target)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // Best effort cleanup; the original persistence failure is the actionable error.
    }
    log.error('failed to persist preferences', error)
    throw error
  }
}

function broadcast(): void {
  const preferences = getPreferences()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send(PREFERENCES_CHANNELS.changed, preferences)
  }
  for (const listener of changeListeners) {
    try {
      listener(preferences)
    } catch (error) {
      log.error('preferences change listener failed', error)
    }
  }
}

export function onPreferencesChanged(listener: (preferences: UserPreferences) => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

function applyThemeSource(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

export function getPreferences(): UserPreferences {
  if (!cached) cached = read()
  return cached
}

export function initPreferences(): void {
  cached = read()
  applyThemeSource(cached.themeMode)
  nativeTheme.on('updated', () => broadcast())
}

function update(
  updater: (current: UserPreferences) => UserPreferences,
  beforeBroadcast?: (next: UserPreferences, current: UserPreferences) => void
): UserPreferences {
  const current = getPreferences()
  const next = normalizePreferences(updater(current))
  write(next)
  beforeBroadcast?.(next, current)
  cached = next
  broadcast()
  return next
}

function mergePatch(current: UserPreferences, patch: PreferencesPatch): UserPreferences {
  const { wallpaper: wallpaperPatch, ...rest } = isRecord(patch) ? patch : {}
  const merged: UserPreferences = { ...current, ...rest }
  if (isRecord(wallpaperPatch)) {
    merged.wallpaper = { ...current.wallpaper, ...wallpaperPatch }
  }
  return normalizePreferences(merged)
}

export function patchPreferences(patch: PreferencesPatch): UserPreferences {
  return update((current) => mergePatch(current, patch))
}

export function setWallpaperAsset(assetPath: string | null): UserPreferences {
  return update((current) =>
    normalizePreferences({ ...current, wallpaper: { ...current.wallpaper, assetPath } })
  )
}

export function registerPreferencesIpc(target: IpcMain = ipcMain): void {
  target.handle(PREFERENCES_CHANNELS.get, () => getPreferences())

  target.handle(PREFERENCES_CHANNELS.patch, (_event, patch: PreferencesPatch) => {
    return update(
      (current) => mergePatch(current, patch),
      (next, current) => {
        if (next.themeMode !== current.themeMode) applyThemeSource(next.themeMode)
      }
    )
  })

  target.handle(PREFERENCES_CHANNELS.addCustomTheme, (_event, theme: ColorThemeDefinition) => {
    return update((current) => {
      const normalized = normalizeCustomTheme(theme)
      if (!normalized) return current
      return {
        ...current,
        customThemes: [
          ...current.customThemes.filter((entry) => entry.id !== normalized.id),
          normalized
        ]
      }
    })
  })

  target.handle(PREFERENCES_CHANNELS.removeCustomTheme, (_event, id: ColorThemeId) => {
    return update((current) => {
      const next: UserPreferences = {
        ...current,
        customThemes: current.customThemes.filter((entry) => entry.id !== id)
      }
      if (current.colorThemeId === id) next.colorThemeId = DEFAULT_PREFERENCES.colorThemeId
      return next
    })
  })
}
