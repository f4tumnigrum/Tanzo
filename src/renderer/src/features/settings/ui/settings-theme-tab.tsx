import {
  AppearanceModeSection,
  ColorThemeSection,
  LanguageSettingsSection,
  ReasoningSection
} from './theme/settings-theme-sections'
import { TypographySection } from './theme/settings-typography-section'
import { WallpaperSection } from './theme/settings-wallpaper-section'

export function SettingsThemeTab() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <LanguageSettingsSection />
      <AppearanceModeSection />
      <ReasoningSection />
      <ColorThemeSection />
      <WallpaperSection />
      <TypographySection />
    </div>
  )
}
