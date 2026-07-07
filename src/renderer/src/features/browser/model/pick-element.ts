export interface PickedElementRaw {
  selector: string
  tag: string
  width: number
  height: number

  anchor: { top: number; left: number; right: number; bottom: number }
  color: string
  backgroundColor: string
  backgroundImage: string
  borderColor: string
  borderWidth: string
  borderStyle: string
  borderRadius: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  letterSpacing: string
  textAlign: string
  textTransform: string
  padding: string
  margin: string
  gap: string
  display: string
  flexDirection: string
  justifyContent: string
  alignItems: string
  opacity: string
  boxShadow: string
  filter: string
  backdropFilter: string
  transform: string
}

export interface DesignToken {
  label: string
  value: string

  swatch?: string
}

export interface DesignTokenGroup {
  title: string
  tokens: DesignToken[]
}

const PICKER_SCRIPT = `
(() => {
  if (window.__tanzoPickerActive) return Promise.resolve(null)
  window.__tanzoPickerActive = true

  return new Promise((resolve) => {
    const HIGHLIGHT_ID = '__tanzo_picker_highlight__'
    const overlay = document.createElement('div')
    overlay.id = HIGHLIGHT_ID
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      background: 'rgba(56,139,253,0.18)',
      border: '1px solid rgba(56,139,253,0.9)',
      borderRadius: '2px',
      boxShadow: '0 0 0 1px rgba(255,255,255,0.35)',
      transition: 'all 0.04s ease-out',
      top: '0px', left: '0px', width: '0px', height: '0px'
    })
    document.documentElement.appendChild(overlay)
    const prevCursor = document.documentElement.style.cursor
    document.documentElement.style.cursor = 'crosshair'

    let current = null

    const cssEscape = (s) =>
      (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')

    const buildSelector = (el) => {
      if (el.id) return el.tagName.toLowerCase() + '#' + cssEscape(el.id)
      const parts = []
      let node = el
      let depth = 0
      while (node && node.nodeType === 1 && depth < 4 && node !== document.body) {
        let part = node.tagName.toLowerCase()
        const cls = (node.getAttribute('class') || '')
          .split(/\\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + cssEscape(c)).join('')
        part += cls
        const parent = node.parentElement
        if (parent) {
          const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
          if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')'
        }
        parts.unshift(part)
        node = node.parentElement
        depth++
      }
      return parts.join(' > ')
    }

    const moveOverlay = (el) => {
      const r = el.getBoundingClientRect()
      overlay.style.top = r.top + 'px'
      overlay.style.left = r.left + 'px'
      overlay.style.width = r.width + 'px'
      overlay.style.height = r.height + 'px'
    }

    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === overlay || el === current) return
      current = el
      moveOverlay(el)
    }

    const cleanup = () => {
      window.__tanzoPickerActive = false
      window.__tanzoPickerStop = null
      document.documentElement.style.cursor = prevCursor
      overlay.remove()
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }

    const onScroll = () => { if (current) moveOverlay(current) }

    // Let the host end pick mode (e.g. toggling the button off) by resolving
    // the pending Promise without a selection.
    window.__tanzoPickerStop = () => { cleanup(); resolve(null) }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null) }
    }

    const onClick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const el = current || document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el.nodeType !== 1) { cleanup(); resolve(null); return }
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const data = {
        selector: buildSelector(el),
        tag: el.tagName.toLowerCase(),
        width: Math.round(r.width),
        height: Math.round(r.height),
        anchor: {
          top: Math.round(r.top),
          left: Math.round(r.left),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom)
        },
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        borderStyle: cs.borderTopStyle,
        borderRadius: cs.borderTopLeftRadius,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        textAlign: cs.textAlign,
        textTransform: cs.textTransform,
        padding: cs.padding,
        margin: cs.margin,
        gap: cs.gap || cs.columnGap || '',
        display: cs.display,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        opacity: cs.opacity,
        boxShadow: cs.boxShadow,
        filter: cs.filter,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || '',
        transform: cs.transform
      }
      cleanup()
      resolve(data)
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
  })
})()
`

export function getPickerScript(): string {
  return PICKER_SCRIPT
}

const STOP_SCRIPT = `(() => { if (window.__tanzoPickerStop) window.__tanzoPickerStop() })()`

export function getStopScript(): string {
  return STOP_SCRIPT
}

const TRANSPARENT_COLOR = /^(transparent|rgba?\(0,\s*0,\s*0,\s*0\))$/i
const NONE_VALUES = new Set(['none', 'normal', '0px', 'auto', '0px 0px 0px 0px', ''])

function isMeaningful(value: string): boolean {
  return value.length > 0 && !NONE_VALUES.has(value.trim().toLowerCase())
}

function isVisibleColor(value: string): boolean {
  return value.length > 0 && !TRANSPARENT_COLOR.test(value.trim())
}

export function buildTokenGroups(
  raw: PickedElementRaw,
  labels: {
    color: string
    typography: string
    layout: string
    spacing: string
    border: string
    effects: string
    textColor: string
    background: string
    gradient: string
    borderColor: string
    fontFamily: string
    fontSize: string
    fontWeight: string
    lineHeight: string
    letterSpacing: string
    textAlign: string
    textTransform: string
    display: string
    flexDirection: string
    justifyContent: string
    alignItems: string
    padding: string
    margin: string
    gap: string
    borderWidth: string
    borderStyle: string
    borderRadius: string
    opacity: string
    boxShadow: string
    filter: string
    backdropFilter: string
    transform: string
  }
): DesignTokenGroup[] {
  const groups: DesignTokenGroup[] = []

  const colors: DesignToken[] = []
  if (isVisibleColor(raw.color))
    colors.push({ label: labels.textColor, value: raw.color, swatch: raw.color })
  if (isVisibleColor(raw.backgroundColor))
    colors.push({
      label: labels.background,
      value: raw.backgroundColor,
      swatch: raw.backgroundColor
    })
  if (isMeaningful(raw.backgroundImage))
    colors.push({
      label: labels.gradient,
      value: raw.backgroundImage,

      swatch: /gradient/i.test(raw.backgroundImage) ? raw.backgroundImage : undefined
    })
  if (isVisibleColor(raw.borderColor) && isMeaningful(raw.borderWidth))
    colors.push({ label: labels.borderColor, value: raw.borderColor, swatch: raw.borderColor })
  if (colors.length) groups.push({ title: labels.color, tokens: colors })

  const typography: DesignToken[] = [
    { label: labels.fontFamily, value: raw.fontFamily },
    { label: labels.fontSize, value: raw.fontSize },
    { label: labels.fontWeight, value: raw.fontWeight },
    { label: labels.lineHeight, value: raw.lineHeight },
    { label: labels.letterSpacing, value: raw.letterSpacing },
    { label: labels.textTransform, value: raw.textTransform }
  ].filter((tk) => isMeaningful(tk.value))
  if (isMeaningful(raw.textAlign) && raw.textAlign !== 'start' && raw.textAlign !== 'left')
    typography.push({ label: labels.textAlign, value: raw.textAlign })
  if (typography.length) groups.push({ title: labels.typography, tokens: typography })

  const layout: DesignToken[] = []
  if (raw.display && raw.display !== 'block' && raw.display !== 'inline')
    layout.push({ label: labels.display, value: raw.display })
  if (/(flex|grid)/.test(raw.display)) {
    if (isMeaningful(raw.flexDirection) && raw.flexDirection !== 'row')
      layout.push({ label: labels.flexDirection, value: raw.flexDirection })
    if (isMeaningful(raw.justifyContent) && raw.justifyContent !== 'normal')
      layout.push({ label: labels.justifyContent, value: raw.justifyContent })
    if (isMeaningful(raw.alignItems) && raw.alignItems !== 'normal')
      layout.push({ label: labels.alignItems, value: raw.alignItems })
  }
  if (layout.length) groups.push({ title: labels.layout, tokens: layout })

  const spacing: DesignToken[] = [
    { label: labels.padding, value: raw.padding },
    { label: labels.margin, value: raw.margin },
    { label: labels.gap, value: raw.gap }
  ].filter((tk) => isMeaningful(tk.value))
  if (spacing.length) groups.push({ title: labels.spacing, tokens: spacing })

  const border: DesignToken[] = []
  if (isMeaningful(raw.borderWidth)) {
    border.push({ label: labels.borderWidth, value: raw.borderWidth })
    if (isMeaningful(raw.borderStyle))
      border.push({ label: labels.borderStyle, value: raw.borderStyle })
  }
  if (isMeaningful(raw.borderRadius))
    border.push({ label: labels.borderRadius, value: raw.borderRadius })
  if (border.length) groups.push({ title: labels.border, tokens: border })

  const effects: DesignToken[] = []
  if (isMeaningful(raw.opacity) && raw.opacity !== '1')
    effects.push({ label: labels.opacity, value: raw.opacity })
  if (isMeaningful(raw.boxShadow)) effects.push({ label: labels.boxShadow, value: raw.boxShadow })
  if (isMeaningful(raw.filter)) effects.push({ label: labels.filter, value: raw.filter })
  if (isMeaningful(raw.backdropFilter))
    effects.push({ label: labels.backdropFilter, value: raw.backdropFilter })
  if (isMeaningful(raw.transform)) effects.push({ label: labels.transform, value: raw.transform })
  if (effects.length) groups.push({ title: labels.effects, tokens: effects })

  return groups
}
