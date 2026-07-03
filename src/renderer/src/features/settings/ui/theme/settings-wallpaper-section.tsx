import { ImageIcon, Moon, PlusIcon, Sun, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  WALLPAPER_BLUR_MAX,
  WALLPAPER_MAX_ASSETS,
  WALLPAPER_OPACITY_MAX,
  WALLPAPER_OPACITY_MIN,
  WALLPAPER_OVERLAY_MAX,
  WALLPAPER_SURFACE_OPACITY_MAX,
  WALLPAPER_SURFACE_OPACITY_MIN,
  type WallpaperAsset,
  type WallpaperFit,
  type WallpaperOverlay,
  type WallpaperSettings
} from '@shared/preferences'
import {
  addWallpaper,
  clearWallpaper,
  patchPreferences,
  removeWallpaper,
  usePreferences
} from '@/common/preferences'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { SectionCard } from '../shared/settings-primitives'

// ─── Slider row ────────────────────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  disabled = false,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-h-11 w-full items-center gap-4 px-3 py-2">
      <span className="w-28 shrink-0 text-[0.8125rem] text-foreground/82">{label}</span>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === 'number') onChange(next)
        }}
      />
      <span className="flex h-6 w-14 shrink-0 items-center justify-center rounded-full bg-muted/35 text-[0.6875rem] tabular-nums text-foreground/65 ring-1 ring-inset ring-border/15">
        {display}
      </span>
    </div>
  )
}

// ─── Fit segmented control ──────────────────────────────────────────────────────

const FIT_OPTIONS: WallpaperFit[] = ['cover', 'contain', 'fill', 'tile']

function FitRow({
  value,
  disabled,
  onChange
}: {
  value: WallpaperFit
  disabled: boolean
  onChange: (fit: WallpaperFit) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-11 w-full items-center gap-4 px-3 py-2">
      <span className="w-28 shrink-0 text-[0.8125rem] text-foreground/82">
        {t('settings.theme.wallpaper.fit.title', { defaultValue: 'Fit' })}
      </span>
      <div className="flex flex-1 gap-px overflow-hidden rounded-[var(--radius-md)] ring-1 ring-inset ring-border/20">
        {FIT_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={cn(
              'flex-1 py-1 text-[0.6875rem] font-medium tracking-[0.01em] transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              value === opt
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/25 text-foreground/62 hover:bg-muted/50 hover:text-foreground/85'
            )}
          >
            {t(`settings.theme.wallpaper.fit.options.${opt}`, { defaultValue: opt })}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Single thumbnail card ───────────────────────────────────────────────────

function WallpaperThumbnail({
  asset,
  isLight,
  isDark,
  onActivateLight,
  onActivateDark,
  onRemove
}: {
  asset: WallpaperAsset
  isLight: boolean
  isDark: boolean
  onActivateLight: () => void
  onActivateDark: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const isActive = isLight || isDark

  return (
    <div className="group/thumb relative select-none">
      {/* Thumbnail image */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t('settings.theme.wallpaper.activate', { defaultValue: 'Activate' })}
        onClick={onActivateLight}
        onKeyDown={(e) => e.key === 'Enter' && onActivateLight()}
        className={cn(
          'relative h-20 w-full cursor-pointer overflow-hidden rounded-[var(--radius-lg)]',
          'ring-2 ring-inset transition-all',
          isActive
            ? 'ring-primary/80 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)_inset]'
            : 'ring-border/20 hover:ring-border/45'
        )}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${asset.path}")` }}
        />
        {/* Gradient overlay at bottom for badges */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Light / Dark mode badges */}
        <div className="absolute bottom-1 left-1 flex gap-1">
          {isLight && (
            <span className="flex items-center gap-0.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[0.5625rem] font-semibold text-black/80 shadow-sm">
              <Sun className="size-2.5" />
            </span>
          )}
          {isDark && (
            <span className="flex items-center gap-0.5 rounded-full bg-black/80 px-1.5 py-0.5 text-[0.5625rem] font-semibold text-white/90 shadow-sm">
              <Moon className="size-2.5" />
            </span>
          )}
        </div>
      </div>

      {/* Hover action strip */}
      <div
        className={cn(
          'absolute right-1 top-1 flex flex-col gap-1',
          'opacity-0 transition-opacity group-hover/thumb:opacity-100'
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t('settings.theme.wallpaper.setDark', { defaultValue: 'Use in dark mode' })}
          onClick={(e) => {
            e.stopPropagation()
            onActivateDark()
          }}
          className="size-6 rounded-full bg-background/80 text-foreground/70 shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
        >
          <Moon className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t('settings.theme.wallpaper.remove', { defaultValue: 'Remove' })}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="size-6 rounded-full bg-background/80 text-foreground/70 shadow-sm backdrop-blur-sm hover:bg-red-500/10 hover:text-red-500"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  )
}

// ─── Library grid ────────────────────────────────────────────────────────────

function WallpaperGrid({ wallpaper }: { wallpaper: WallpaperSettings }) {
  const { t } = useTranslation()
  const full = wallpaper.assets.length >= WALLPAPER_MAX_ASSETS

  return (
    <div className="px-3 py-3">
      <div className="grid grid-cols-3 gap-2">
        {wallpaper.assets.map((asset) => (
          <WallpaperThumbnail
            key={asset.id}
            asset={asset}
            isLight={wallpaper.activeId === asset.id}
            isDark={wallpaper.darkAssetId === asset.id}
            onActivateLight={() => void patchPreferences({ wallpaper: { activeId: asset.id } })}
            onActivateDark={() =>
              void patchPreferences({
                wallpaper: {
                  darkAssetId: wallpaper.darkAssetId === asset.id ? null : asset.id
                }
              })
            }
            onRemove={() => void removeWallpaper(asset.id)}
          />
        ))}
        {!full && (
          <button
            type="button"
            onClick={() => void addWallpaper()}
            className={cn(
              'flex h-20 w-full flex-col items-center justify-center gap-1.5',
              'rounded-[var(--radius-lg)] border-2 border-dashed border-border/30',
              'text-foreground/35 transition-colors',
              'hover:border-border/55 hover:text-foreground/60'
            )}
          >
            <PlusIcon className="size-4" />
            <span className="text-[0.5625rem] font-medium tracking-[0.02em]">
              {t('settings.theme.wallpaper.add')}
            </span>
          </button>
        )}
      </div>
      {wallpaper.assets.length > 0 && (
        <p className="mt-2 text-[0.5625rem] leading-4 text-foreground/38">
          {t('settings.theme.wallpaper.hint')}
        </p>
      )}
    </div>
  )
}

// ─── Overlay row ─────────────────────────────────────────────────────────────

const OVERLAY_ORDER: WallpaperOverlay[] = ['none', 'dark', 'light']

function OverlayRow({
  overlay,
  disabled,
  onChange
}: {
  overlay: WallpaperOverlay
  disabled: boolean
  onChange: (v: WallpaperOverlay) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-11 w-full items-center gap-4 px-3 py-2">
      <span className="w-28 shrink-0 text-[0.8125rem] text-foreground/82">
        {t('settings.theme.wallpaper.overlay.title')}
      </span>
      <div className="flex flex-1 gap-px overflow-hidden rounded-[var(--radius-md)] ring-1 ring-inset ring-border/20">
        {OVERLAY_ORDER.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={cn(
              'flex-1 py-1 text-[0.6875rem] font-medium tracking-[0.01em] transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              overlay === opt
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/25 text-foreground/62 hover:bg-muted/50 hover:text-foreground/85'
            )}
          >
            {t(`settings.theme.wallpaper.overlay.options.${opt}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function WallpaperSection() {
  const { t } = useTranslation()
  const wallpaper = usePreferences().wallpaper
  const active = wallpaper.activeId !== null

  return (
    <SectionCard
      icon={<ImageIcon className="size-4" />}
      title={t('settings.theme.wallpaper.title')}
      description={t('settings.theme.wallpaper.description')}
      action={
        wallpaper.assets.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void clearWallpaper()}
            className="gap-1.5 text-foreground/52 hover:text-foreground/80"
          >
            <X className="size-3" />
            {t('settings.theme.wallpaper.clearAll')}
          </Button>
        ) : undefined
      }
    >
      {/* Empty state */}
      {wallpaper.assets.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-3 py-8">
          <ImageIcon className="size-8 text-foreground/20" />
          <p className="text-[0.8125rem] text-foreground/45">
            {t('settings.theme.wallpaper.empty')}
          </p>
          <Button variant="outline" size="sm" onClick={() => void addWallpaper()}>
            <PlusIcon className="mr-1.5 size-3.5" />
            {t('settings.theme.wallpaper.add')}
          </Button>
        </div>
      )}

      {/* Library grid */}
      {wallpaper.assets.length > 0 && <WallpaperGrid wallpaper={wallpaper} />}

      {/* Appearance controls */}
      <FitRow
        value={wallpaper.fit}
        disabled={!active}
        onChange={(fit) => void patchPreferences({ wallpaper: { fit } })}
      />
      <SliderRow
        label={t('settings.theme.wallpaper.opacity')}
        value={wallpaper.opacity}
        min={WALLPAPER_OPACITY_MIN}
        max={WALLPAPER_OPACITY_MAX}
        step={0.05}
        display={`${Math.round(wallpaper.opacity * 100)}%`}
        disabled={!active}
        onChange={(opacity) => void patchPreferences({ wallpaper: { opacity } })}
      />
      <SliderRow
        label={t('settings.theme.wallpaper.blur')}
        value={wallpaper.blur}
        min={0}
        max={WALLPAPER_BLUR_MAX}
        step={1}
        display={`${wallpaper.blur}px`}
        disabled={!active}
        onChange={(blur) => void patchPreferences({ wallpaper: { blur } })}
      />
      <OverlayRow
        overlay={wallpaper.overlay}
        disabled={!active}
        onChange={(overlay) => void patchPreferences({ wallpaper: { overlay } })}
      />
      <SliderRow
        label={t('settings.theme.wallpaper.overlay.strength')}
        value={wallpaper.overlayStrength}
        min={0}
        max={WALLPAPER_OVERLAY_MAX}
        step={0.05}
        display={`${Math.round(wallpaper.overlayStrength * 100)}%`}
        disabled={!active || wallpaper.overlay === 'none'}
        onChange={(overlayStrength) => void patchPreferences({ wallpaper: { overlayStrength } })}
      />
      <SliderRow
        label={t('settings.theme.wallpaper.surfaceOpacity')}
        value={wallpaper.surfaceOpacity}
        min={WALLPAPER_SURFACE_OPACITY_MIN}
        max={WALLPAPER_SURFACE_OPACITY_MAX}
        step={0.05}
        display={`${Math.round(wallpaper.surfaceOpacity * 100)}%`}
        disabled={!active}
        onChange={(surfaceOpacity) => void patchPreferences({ wallpaper: { surfaceOpacity } })}
      />
    </SectionCard>
  )
}
