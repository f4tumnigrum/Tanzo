export type {
  ColorThemeDefinition,
  ColorThemeId,
  ThemeColors,
  ThemeOverrides,
  RadiusPresetId,
  DensityPresetId,
  TypographySettings
} from '@shared/preferences'

export interface RadiusPreset {
  id: import('@shared/preferences').RadiusPresetId
  name: string
  description: string
  value: string
}

export interface DensityPreset {
  id: import('@shared/preferences').DensityPresetId
  name: string
  description: string
  spacing: string
}
