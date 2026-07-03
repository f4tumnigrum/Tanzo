export type ThemeMode = 'light' | 'dark' | 'system'

export type ColorThemeId = string
export type RadiusPresetId = 'sharp' | 'balanced' | 'soft' | 'pill'
export type DensityPresetId = 'compact' | 'comfortable' | 'spacious'
export type FontSizePresetId = 'small' | 'default' | 'large'
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

export type WallpaperOverlay = 'none' | 'dark' | 'light'

export interface WallpaperSettings {
  assetPath: string | null
  opacity: number
  blur: number
  overlay: WallpaperOverlay
  overlayStrength: number
}

export interface UserPreferences {
  themeMode: ThemeMode
  colorThemeId: ColorThemeId
  radiusPresetId: RadiusPresetId
  densityPresetId: DensityPresetId
  fontSizePresetId: FontSizePresetId
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

export const DEFAULT_WALLPAPER: WallpaperSettings = {
  assetPath: null,
  opacity: 0.35,
  blur: 8,
  overlay: 'none',
  overlayStrength: 0.3
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  themeMode: 'system',
  colorThemeId: 'tanzo',
  radiusPresetId: 'balanced',
  densityPresetId: 'comfortable',
  fontSizePresetId: 'default',
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
  setWallpaper: 'preferences:set-wallpaper',
  clearWallpaper: 'preferences:clear-wallpaper',
  changed: 'preferences:changed'
} as const

export type WallpaperAppearancePatch = Partial<
  Pick<WallpaperSettings, 'opacity' | 'blur' | 'overlay' | 'overlayStrength'>
>

export type PreferencesPatch = Partial<
  Pick<
    UserPreferences,
    | 'themeMode'
    | 'colorThemeId'
    | 'radiusPresetId'
    | 'densityPresetId'
    | 'fontSizePresetId'
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
}
