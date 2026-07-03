import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Liquid glass surface — native implementation, no external library.
 *
 * How it works (all Chromium-native, validated in spike/liquid-glass-prototype.html):
 * - A vector displacement map (pure SVG data URI, no canvas, no per-pixel JS) encodes
 *   x-displacement in R and y-displacement in B. The center is neutral #808080, so the
 *   backdrop refracts only at the bezel and content behind the center stays sharp.
 * - The map feeds an feDisplacementMap that runs INSIDE backdrop-filter, combined with
 *   blur + saturate in a single compositor pass.
 * - The map regenerates only on resize (ResizeObserver); pointer interaction writes CSS
 *   custom properties directly on the element via rAF — zero React re-renders.
 */

function displacementMapURI(width: number, height: number, radius: number, bezel: number): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const r = Math.min(radius, Math.min(w, h) / 2)
  const inner = Math.max(0, r - bezel)
  const blur = bezel / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs>` +
    `<linearGradient id="x" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#000000"/>` +
    `</linearGradient>` +
    `<linearGradient id="y" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#0000ff"/><stop offset="1" stop-color="#000000"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="#808080"/>` +
    `<rect width="${w}" height="${h}" rx="${r}" fill="url(#x)"/>` +
    `<rect width="${w}" height="${h}" rx="${r}" fill="url(#y)" style="mix-blend-mode:screen"/>` +
    `<rect x="${bezel}" y="${bezel}" width="${w - 2 * bezel}" height="${h - 2 * bezel}" rx="${inner}" fill="#808080" style="filter:blur(${blur}px)"/>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

interface LiquidGlassProps extends React.ComponentProps<'div'> {
  /** Multiplies refraction strength. 0 disables displacement (frost only). */
  intensity?: number
  /** Adds RGB fringing at the bezel (three displacement taps, ~3x backdrop cost). */
  aberration?: boolean
  /** Track the pointer to drive the specular highlight. */
  interactive?: boolean
}

function LiquidGlass({
  className,
  intensity = 1,
  aberration = false,
  interactive = true,
  children,
  ...props
}: LiquidGlassProps) {
  const reactId = React.useId()
  const filterId = `lg-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const ref = React.useRef<HTMLDivElement>(null)
  const backdropRef = React.useRef<HTMLDivElement>(null)
  const mapRefs = React.useRef<(SVGFEImageElement | null)[]>([])
  const rafRef = React.useRef(0)
  // Frost tier: no SVG filter at all. Mounting the displacement filter with
  // scale 0 still costs a one-off filter compile the first time the element
  // becomes visible, which shows up as a stutter on fade-in transitions.
  const refract = intensity > 0

  React.useLayoutEffect(() => {
    const el = ref.current
    const backdrop = backdropRef.current
    if (!el || !backdrop || !refract) return
    let cancelled = false
    let latest = ''
    const refresh = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
      const bezel = Math.max(8, Math.min(56, Math.min(rect.width, rect.height) * 0.22))
      const uri = displacementMapURI(rect.width, rect.height, radius, bezel)
      if (uri === latest) return
      latest = uri
      // Decode the map before wiring it into the filter: swapping in an
      // undecoded feImage renders several broken frames (backdrop shifts,
      // then snaps once the image loads). Until then the ::before frost
      // baseline shows, so the surface never looks broken.
      const img = new Image()
      img.src = uri
      const apply = (): void => {
        if (cancelled || uri !== latest) return
        for (const node of mapRefs.current) node?.setAttribute('href', uri)
        const filter = `url(#${filterId}) blur(var(--glass-surface-blur)) saturate(var(--glass-surface-saturation))`
        backdrop.style.backdropFilter = filter
        backdrop.style.setProperty('-webkit-backdrop-filter', filter)
        el.setAttribute('data-lg-ready', '')
      }
      img.decode().then(apply, apply)
    }
    refresh()
    const observer = new ResizeObserver(refresh)
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [aberration, filterId, refract])

  React.useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const handlePointerMove = interactive
    ? (event: React.PointerEvent<HTMLDivElement>): void => {
        const { clientX, clientY } = event
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          const el = ref.current
          if (!el) return
          const rect = el.getBoundingClientRect()
          el.style.setProperty('--lg-px', ((clientX - rect.left) / rect.width).toFixed(3))
          el.style.setProperty('--lg-py', ((clientY - rect.top) / rect.height).toFixed(3))
        })
      }
    : undefined

  const scale = 0.14 * intensity

  return (
    <div
      ref={ref}
      data-slot="liquid-glass"
      className={cn('relative isolate rounded-xl', className)}
      onPointerMove={handlePointerMove}
      {...props}
    >
      <div ref={backdropRef} data-slot="liquid-glass-backdrop" aria-hidden="true" />
      {refract ? (
        <svg width="0" height="0" aria-hidden="true" className="absolute">
          <defs>
            <filter
              id={filterId}
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
              primitiveUnits="objectBoundingBox"
            >
              {aberration ? (
                <>
                  <feImage
                    ref={(node) => void (mapRefs.current[0] = node)}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="none"
                    result="map"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="map"
                    scale={scale * 1.2}
                    xChannelSelector="R"
                    yChannelSelector="B"
                    result="dr"
                  />
                  <feColorMatrix
                    in="dr"
                    type="matrix"
                    values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                    result="r"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="map"
                    scale={scale}
                    xChannelSelector="R"
                    yChannelSelector="B"
                    result="dg"
                  />
                  <feColorMatrix
                    in="dg"
                    type="matrix"
                    values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                    result="g"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="map"
                    scale={scale * 0.8}
                    xChannelSelector="R"
                    yChannelSelector="B"
                    result="db"
                  />
                  <feColorMatrix
                    in="db"
                    type="matrix"
                    values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                    result="b"
                  />
                  <feBlend in="g" in2="b" mode="screen" result="gb" />
                  <feBlend in="r" in2="gb" mode="screen" />
                </>
              ) : (
                <>
                  <feImage
                    ref={(node) => void (mapRefs.current[0] = node)}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="none"
                    result="map"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="map"
                    scale={scale}
                    xChannelSelector="R"
                    yChannelSelector="B"
                  />
                </>
              )}
            </filter>
          </defs>
        </svg>
      ) : null}
      {children}
    </div>
  )
}

export { LiquidGlass, displacementMapURI }
export type { LiquidGlassProps }
