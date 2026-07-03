import { app, BrowserWindow, ipcMain, nativeTheme, type IpcMain } from 'electron'
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  DEFAULT_PREFERENCES,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_WALLPAPER,
  PET_SCALE_DEFAULT,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  PREFERENCES_CHANNELS,
  TYPOGRAPHY_CODE_FONT_SIZE_MAX,
  TYPOGRAPHY_CODE_FONT_SIZE_MIN,
  TYPOGRAPHY_FONT_SIZE_MAX,
  TYPOGRAPHY_FONT_SIZE_MIN,
  TYPOGRAPHY_LINE_HEIGHT_MAX,
  TYPOGRAPHY_LINE_HEIGHT_MIN,
  WALLPAPER_BLUR_MAX,
  WALLPAPER_MAX_ASSETS,
  WALLPAPER_OPACITY_MAX,
  WALLPAPER_OPACITY_MIN,
  WALLPAPER_OVERLAY_MAX,
  WALLPAPER_SURFACE_OPACITY_MAX,
  WALLPAPER_SURFACE_OPACITY_MIN,
  type ColorThemeDefinition,
  type ColorThemeId,
  type DensityPresetId,
  type Language,
  type PetPosition,
  type PreferencesPatch,
  type RadiusPresetId,
  type ThemeColors,
  type ThemeMode,
  type ThemeOverrides,
  type TypographySettings,
  type UserPreferences,
  type WallpaperAsset,
  type WallpaperFit,
  type WallpaperOverlay,
  type WallpaperSettings
} from '@shared/preferences'
import { createLogger } from './logger'
import { TOGGLEABLE_TOOL_IDS, isMcpToolId } from '@shared/tool-catalog'

const log = createLogger('preferences')

const FILE_NAME = 'preferences.json'
const VALID_THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']
const VALID_RADIUS_PRESETS: readonly RadiusPresetId[] = ['sharp', 'balanced', 'soft', 'pill']
const VALID_DENSITY_PRESETS: readonly DensityPresetId[] = ['compact', 'comfortable', 'spacious']
const VALID_LANGUAGES: readonly Language[] = ['en', 'zh-CN']
const VALID_WALLPAPER_OVERLAYS: readonly WallpaperOverlay[] = ['none', 'dark', 'light']
const VALID_WALLPAPER_FITS: readonly WallpaperFit[] = ['cover', 'contain', 'fill', 'tile']
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
  // Keep known toggleable ids plus dynamic MCP tool ids (mcp__server__tool).
  // Stale builtin ids from older versions and locked tool ids are dropped.
  const known = new Set(TOGGLEABLE_TOOL_IDS)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || seen.has(item)) continue
    if (!known.has(item) && !isMcpToolId(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/**
 * The browser capability used to be a per-tool toggle (`disabledTools:
 * ['browserOpen']`). Carry that intent over: when the new preference is absent
 * but the old per-tool disable is present, treat browser automation as off.
 */
function normalizeBrowserAutomation(value: unknown, disabledTools: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (Array.isArray(disabledTools) && disabledTools.includes('browserOpen')) return false
  return DEFAULT_PREFERENCES.browserAutomation
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function normalizeWallpaperAsset(value: unknown): WallpaperAsset | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const path = typeof value.path === 'string' ? value.path.trim() : ''
  const addedAt = typeof value.addedAt === 'string' ? value.addedAt : new Date().toISOString()
  if (!id || !path) return null
  return { id, path, addedAt }
}

function normalizeWallpaper(value: unknown): WallpaperSettings {
  const parsed = isRecord(value) ? value : {}

  // ── legacy migration: assetPath → single-asset library ──────────────────
  let assets: WallpaperAsset[]
  let activeId: string | null
  if (Array.isArray(parsed.assets)) {
    const seen = new Set<string>()
    assets = (parsed.assets as unknown[])
      .map(normalizeWallpaperAsset)
      .filter(
        (a): a is WallpaperAsset => a !== null && !seen.has(a.id) && seen.add(a.id) !== undefined
      )
      .slice(0, WALLPAPER_MAX_ASSETS)
    activeId =
      typeof parsed.activeId === 'string' && assets.some((a) => a.id === parsed.activeId)
        ? parsed.activeId
        : (assets[0]?.id ?? null)
  } else {
    // v1 format: single assetPath field
    const legacyPath =
      typeof parsed.assetPath === 'string' && parsed.assetPath.trim().length > 0
        ? parsed.assetPath.trim()
        : null
    if (legacyPath) {
      const legacyAsset: WallpaperAsset = {
        id: 'legacy',
        path: legacyPath,
        addedAt: new Date().toISOString()
      }
      assets = [legacyAsset]
      activeId = 'legacy'
    } else {
      assets = []
      activeId = null
    }
  }

  const darkAssetId =
    typeof parsed.darkAssetId === 'string' && assets.some((a) => a.id === parsed.darkAssetId)
      ? parsed.darkAssetId
      : null

  return {
    assets,
    activeId,
    darkAssetId,
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
    ),
    fit: isOneOf(parsed.fit, VALID_WALLPAPER_FITS) ? parsed.fit : DEFAULT_WALLPAPER.fit,
    surfaceOpacity: clampNumber(
      parsed.surfaceOpacity,
      WALLPAPER_SURFACE_OPACITY_MIN,
      WALLPAPER_SURFACE_OPACITY_MAX,
      DEFAULT_WALLPAPER.surfaceOpacity
    )
  }
}

/** Font sizes from the pre-typography fontSizePresetId preference. */
const LEGACY_FONT_SIZE_PRESETS: Record<string, number> = {
  small: 14,
  default: 16,
  large: 18
}

function normalizeFontStack(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) return null
  // Font stacks are injected into CSS custom properties; reject values that
  // could escape the declaration or smuggle in extra rules.
  if (/[;{}<>]|url\s*\(/i.test(trimmed)) return null
  return trimmed
}

function normalizeTypography(value: unknown, legacyFontSizePreset: unknown): TypographySettings {
  const parsed = isRecord(value) ? value : {}
  const legacyFontSize =
    typeof legacyFontSizePreset === 'string'
      ? LEGACY_FONT_SIZE_PRESETS[legacyFontSizePreset]
      : undefined
  return {
    fontSize: clampNumber(
      parsed.fontSize,
      TYPOGRAPHY_FONT_SIZE_MIN,
      TYPOGRAPHY_FONT_SIZE_MAX,
      legacyFontSize ?? DEFAULT_TYPOGRAPHY.fontSize
    ),
    codeFontSize: clampNumber(
      parsed.codeFontSize,
      TYPOGRAPHY_CODE_FONT_SIZE_MIN,
      TYPOGRAPHY_CODE_FONT_SIZE_MAX,
      DEFAULT_TYPOGRAPHY.codeFontSize
    ),
    lineHeight: clampNumber(
      parsed.lineHeight,
      TYPOGRAPHY_LINE_HEIGHT_MIN,
      TYPOGRAPHY_LINE_HEIGHT_MAX,
      DEFAULT_TYPOGRAPHY.lineHeight
    ),
    sansFont: normalizeFontStack(parsed.sansFont),
    monoFont: normalizeFontStack(parsed.monoFont)
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
    typography: normalizeTypography(parsed.typography, parsed.fontSizePresetId),
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
    disabledTools: normalizeDisabledTools(parsed.disabledTools),
    browserAutomation: normalizeBrowserAutomation(parsed.browserAutomation, parsed.disabledTools)
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
  const {
    wallpaper: wallpaperPatch,
    typography: typographyPatch,
    ...rest
  } = isRecord(patch) ? patch : ({} as PreferencesPatch)
  const merged: UserPreferences = { ...current, ...rest }
  if (isRecord(wallpaperPatch)) {
    merged.wallpaper = { ...current.wallpaper, ...wallpaperPatch }
  }
  if (isRecord(typographyPatch)) {
    merged.typography = { ...current.typography, ...typographyPatch }
  }
  return normalizePreferences(merged)
}

export function patchPreferences(patch: PreferencesPatch): UserPreferences {
  return update((current) => mergePatch(current, patch))
}

export function addWallpaperAsset(asset: WallpaperAsset): UserPreferences {
  return update((current) => {
    const existing = current.wallpaper.assets.filter((a) => a.id !== asset.id)
    const assets = [...existing, asset].slice(-WALLPAPER_MAX_ASSETS)
    return normalizePreferences({
      ...current,
      wallpaper: { ...current.wallpaper, assets, activeId: asset.id }
    })
  })
}

export function removeWallpaperAsset(id: string): UserPreferences {
  return update((current) => {
    const assets = current.wallpaper.assets.filter((a) => a.id !== id)
    const activeId =
      current.wallpaper.activeId === id ? (assets[0]?.id ?? null) : current.wallpaper.activeId
    const darkAssetId = current.wallpaper.darkAssetId === id ? null : current.wallpaper.darkAssetId
    return normalizePreferences({
      ...current,
      wallpaper: { ...current.wallpaper, assets, activeId, darkAssetId }
    })
  })
}

export function clearAllWallpapers(): UserPreferences {
  return update((current) =>
    normalizePreferences({
      ...current,
      wallpaper: { ...current.wallpaper, assets: [], activeId: null, darkAssetId: null }
    })
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

  // wallpaper asset management is handled in wallpaper.ts via addWallpaperAsset /
  // removeWallpaperAsset — IPC for those is registered in registerWallpaperIpc.
}
