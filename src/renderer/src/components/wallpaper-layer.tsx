import { useLayoutEffect } from 'react'
import { usePreferences } from '@/common/preferences'
import { useTheme } from '@/components/theme/theme-provider'
import type { WallpaperFit, WallpaperOverlay, WallpaperSettings } from '@shared/preferences'

// Base solid-color percentage for each surface at surfaceOpacity = 1.
// Lowering surfaceOpacity towards 0 makes surfaces increasingly see-through.
const SURFACE_BASE: Array<[string, string, number]> = [
  ['--main-surface-bg', 'var(--background)', 80],
  ['--sidebar-surface-bg', 'var(--sidebar)', 55],
  ['--sidebar-solid-bg', 'var(--sidebar)', 55],
  ['--toolbar-surface-bg', 'var(--background)', 85],
  ['--compose-surface-bg', 'var(--card)', 80]
]

function overlayColor(overlay: WallpaperOverlay, strength: number): string | null {
  if (overlay === 'dark') return `rgba(0,0,0,${strength})`
  if (overlay === 'light') return `rgba(255,255,255,${strength})`
  return null
}

function cssUrl(path: string): string {
  const escaped = path.replace(/["\\\n\r]/g, (c) => `\\${c === '\n' ? 'a' : c === '\r' ? 'd' : c}`)
  return `url("${escaped}")`
}

function fitToCSS(fit: WallpaperFit): React.CSSProperties {
  if (fit === 'tile') {
    return { backgroundRepeat: 'repeat', backgroundSize: 'auto', backgroundPosition: 'top left' }
  }
  const sizeMap: Record<string, string> = {
    cover: 'cover',
    contain: 'contain',
    fill: '100% 100%'
  }
  return {
    backgroundSize: sizeMap[fit] ?? 'cover',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center'
  }
}

function useSurfaceOpacity(active: boolean, surfaceOpacity: number): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    const keys = SURFACE_BASE.map(([k]) => k)

    if (!active) {
      for (const k of keys) root.style.removeProperty(k)
      return
    }

    for (const [key, color, basePct] of SURFACE_BASE) {
      const pct = Math.round(basePct * surfaceOpacity)
      root.style.setProperty(key, `color-mix(in oklab, ${color} ${pct}%, transparent)`)
    }

    return () => {
      for (const k of keys) root.style.removeProperty(k)
    }
  }, [active, surfaceOpacity])
}

export function WallpaperLayer(): React.JSX.Element | null {
  const wallpaper: WallpaperSettings = usePreferences().wallpaper
  const { resolvedTheme } = useTheme()

  // Pick the correct asset for the current color mode.
  const assetId =
    resolvedTheme === 'dark' && wallpaper.darkAssetId != null
      ? wallpaper.darkAssetId
      : wallpaper.activeId
  const asset = assetId != null ? wallpaper.assets.find((a) => a.id === assetId) : undefined
  const active = asset != null

  useSurfaceOpacity(active, wallpaper.surfaceOpacity)

  if (!active || !asset) return null

  const overflow = Math.max(0, wallpaper.blur * 2)
  const tint = overlayColor(wallpaper.overlay, wallpaper.overlayStrength)
  const fitStyle = fitToCSS(wallpaper.fit)

  return (
    <div
      aria-hidden
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: -1 }}
    >
      <div
        style={{
          position: 'absolute',
          inset: `-${overflow}px`,
          backgroundImage: cssUrl(asset.path),
          ...fitStyle,
          opacity: wallpaper.opacity,
          filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined
        }}
      />
      {tint ? <div style={{ position: 'absolute', inset: 0, backgroundColor: tint }} /> : null}
    </div>
  )
}
