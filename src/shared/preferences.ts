export type ThemeMode = 'light' | 'dark' | 'system'

export type ColorThemeId = string
export type RadiusPresetId = 'sharp' | 'balanced' | 'soft' | 'pill'
export type DensityPresetId = 'compact' | 'comfortable' | 'spacious'
export type Language = 'en' | 'zh-CN'

export interface ThemeColors {
  background: string
  foreground: string
  card: string
  'card-foreground': string
  popover: string
  'popover-foreground': string
  primary: string
  'primary-foreground': string
  secondary: string
  'secondary-foreground': string
  muted: string
  'muted-foreground': string
  accent: string
  'accent-foreground': string
  destructive: string
  'destructive-foreground': string
  border: string
  input: string
  ring: string
  sidebar: string
  'sidebar-foreground': string
  'sidebar-primary': string
  'sidebar-primary-foreground': string
  'sidebar-accent': string
  'sidebar-accent-foreground': string
  'sidebar-border': string
  'sidebar-ring': string
  'chart-1': string
  'chart-2': string
  'chart-3': string
  'chart-4': string
  'chart-5': string
}

export interface ThemeOverrides {
  radius?: string
  spacing?: string
  'tracking-normal'?: string
  'font-sans'?: string
  'font-serif'?: string
  'font-mono'?: string
  'shadow-2xs'?: string
  'shadow-xs'?: string
  'shadow-sm'?: string
  shadow?: string
  'shadow-md'?: string
  'shadow-lg'?: string
  'shadow-xl'?: string
  'shadow-2xl'?: string
}

export interface ColorThemeDefinition {
  id: ColorThemeId
  name: string
  description: string
  light: ThemeColors
  dark: ThemeColors
  lightOverrides?: ThemeOverrides
  darkOverrides?: ThemeOverrides
}

export interface PetPosition {
  x: number
  y: number
}

export interface TypographySettings {
  /** Base UI font size in px. */
  fontSize: number
  /** Monospace/code font size in px, independent of the base size. */
  codeFontSize: number
  /** Unitless line-height applied to chat and reading content. */
  lineHeight: number
  /** CSS font-family stack overriding the theme sans font; null follows the theme. */
  sansFont: string | null
  /** CSS font-family stack overriding the theme mono font; null follows the theme. */
  monoFont: string | null
}

export type WallpaperOverlay = 'none' | 'dark' | 'light'
export type WallpaperFit = 'cover' | 'contain' | 'fill' | 'tile'

export interface WallpaperAsset {
  id: string
  path: string
  /** ISO timestamp of when the asset was imported. */
  addedAt: string
}

export interface WallpaperSettings {
  /** Ordered list of stored wallpaper assets. */
  assets: WallpaperAsset[]
  /** Id of the active asset for light mode (or both when darkAssetId is null). */
  activeId: string | null
  /** Id of the active asset for dark mode. null = follow activeId. */
  darkAssetId: string | null
  opacity: number
  blur: number
  overlay: WallpaperOverlay
  overlayStrength: number
  fit: WallpaperFit
  /**
   * 0–1 multiplier applied to the semi-transparent surface layers (sidebar,
   * toolbar, main area) when a wallpaper is active. Lower = more transparent.
   */
  surfaceOpacity: number
}

export interface UserPreferences {
  themeMode: ThemeMode
  colorThemeId: ColorThemeId
  radiusPresetId: RadiusPresetId
  densityPresetId: DensityPresetId
  typography: TypographySettings
  language: Language | null
  customThemes: ColorThemeDefinition[]
  reasoningExpandedByDefault: boolean
  petEnabled: boolean
  petId: string | null
  petPosition: PetPosition | null
  petScale: number
  wallpaper: WallpaperSettings
  /** Built-in tool ids the user has disabled; filtered out of the agent's tool set. */
  disabledTools: string[]
  /**
   * Master switch for the browser-automation capability. Gates the browserOpen
   * tool, the built-in chrome-devtools MCP server, the built-in browser skill,
   * and (on next launch) the Chromium remote-debugging port.
   */
  browserAutomation: boolean
}

export const PET_SCALE_MIN = 0.5
export const PET_SCALE_MAX = 3
export const PET_SCALE_DEFAULT = 1

export const WALLPAPER_OPACITY_MIN = 0.05
export const WALLPAPER_OPACITY_MAX = 1
export const WALLPAPER_BLUR_MAX = 40
export const WALLPAPER_OVERLAY_MAX = 0.9
export const WALLPAPER_SURFACE_OPACITY_MIN = 0
export const WALLPAPER_SURFACE_OPACITY_MAX = 1
export const WALLPAPER_MAX_ASSETS = 12

export const TYPOGRAPHY_FONT_SIZE_MIN = 12
export const TYPOGRAPHY_FONT_SIZE_MAX = 20
export const TYPOGRAPHY_CODE_FONT_SIZE_MIN = 9
export const TYPOGRAPHY_CODE_FONT_SIZE_MAX = 16
export const TYPOGRAPHY_LINE_HEIGHT_MIN = 1.4
export const TYPOGRAPHY_LINE_HEIGHT_MAX = 2

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontSize: 16,
  codeFontSize: 11,
  lineHeight: 1.72,
  sansFont: null,
  monoFont: null
}

export const DEFAULT_WALLPAPER: WallpaperSettings = {
  assets: [],
  activeId: null,
  darkAssetId: null,
  opacity: 0.35,
  blur: 8,
  overlay: 'none',
  overlayStrength: 0.3,
  fit: 'cover',
  surfaceOpacity: 1
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  themeMode: 'system',
  colorThemeId: 'tanzo',
  radiusPresetId: 'balanced',
  densityPresetId: 'comfortable',
  typography: DEFAULT_TYPOGRAPHY,
  language: null,
  customThemes: [],
  reasoningExpandedByDefault: true,
  petEnabled: false,
  petId: null,
  petPosition: null,
  petScale: PET_SCALE_DEFAULT,
  wallpaper: DEFAULT_WALLPAPER,
  disabledTools: [],
  browserAutomation: true
}

export const PREFERENCES_CHANNELS = {
  get: 'preferences:get',
  patch: 'preferences:patch',
  addCustomTheme: 'preferences:add-custom-theme',
  removeCustomTheme: 'preferences:remove-custom-theme',
  addWallpaper: 'preferences:add-wallpaper',
  removeWallpaper: 'preferences:remove-wallpaper',
  clearWallpaper: 'preferences:clear-wallpaper',
  changed: 'preferences:changed'
} as const

export type WallpaperAppearancePatch = Partial<
  Pick<
    WallpaperSettings,
    | 'opacity'
    | 'blur'
    | 'overlay'
    | 'overlayStrength'
    | 'fit'
    | 'surfaceOpacity'
    | 'activeId'
    | 'darkAssetId'
  >
>

export type TypographyPatch = Partial<TypographySettings>

export type PreferencesPatch = Partial<
  Pick<
    UserPreferences,
    | 'themeMode'
    | 'colorThemeId'
    | 'radiusPresetId'
    | 'densityPresetId'
    | 'language'
    | 'reasoningExpandedByDefault'
    | 'petEnabled'
    | 'petId'
    | 'petPosition'
    | 'petScale'
    | 'disabledTools'
    | 'browserAutomation'
  >
> & {
  wallpaper?: WallpaperAppearancePatch
  typography?: TypographyPatch
}
