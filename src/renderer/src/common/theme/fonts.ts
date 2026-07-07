import { useEffect, useState } from 'react'

export interface FontOption {
  value: string

  label: string
  kind: 'sans' | 'mono'
}

export const BUNDLED_SANS_FONTS: FontOption[] = [
  { value: "'Geist Variable', sans-serif", label: 'Geist', kind: 'sans' },
  { value: "'Inter Variable', sans-serif", label: 'Inter', kind: 'sans' }
]

export const BUNDLED_MONO_FONTS: FontOption[] = [
  { value: "'Geist Mono Variable', monospace", label: 'Geist Mono', kind: 'mono' },
  { value: "'JetBrains Mono Variable', monospace", label: 'JetBrains Mono', kind: 'mono' }
]

interface LocalFontData {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

const MONO_HINTS = ['mono', 'code', 'consol', 'courier', 'menlo', 'monaco', 'sf mono', 'terminal']

function isLikelyMono(family: string): boolean {
  const lower = family.toLowerCase()
  return MONO_HINTS.some((hint) => lower.includes(hint))
}

function toOption(family: string): FontOption {
  const quoted = family.includes(' ') ? `'${family}'` : family
  const kind = isLikelyMono(family) ? 'mono' : 'sans'
  return {
    value: `${quoted}, ${kind === 'mono' ? 'monospace' : 'sans-serif'}`,
    label: family,
    kind
  }
}

let localFontsCache: FontOption[] | null = null

export async function loadLocalFonts(): Promise<FontOption[]> {
  if (localFontsCache) return localFontsCache
  const query = window.queryLocalFonts
  if (typeof query !== 'function') return []
  try {
    const fonts = await query.call(window)
    const families = new Set<string>()
    for (const font of fonts) {
      if (font.family) families.add(font.family)
    }
    localFontsCache = [...families].sort((a, b) => a.localeCompare(b)).map(toOption)
    return localFontsCache
  } catch {
    return []
  }
}

export function useLocalFonts(): FontOption[] {
  const [fonts, setFonts] = useState<FontOption[]>(localFontsCache ?? [])
  useEffect(() => {
    if (localFontsCache) return
    let cancelled = false
    void loadLocalFonts().then((loaded) => {
      if (!cancelled && loaded.length > 0) setFonts(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return fonts
}
