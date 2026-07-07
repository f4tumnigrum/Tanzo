import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildTokenGroups, type PickedElementRaw } from '../model/pick-element'

const COPY_RESET_MS = 1200
const TIP_WIDTH = 268
const GAP = 12
const MARGIN = 10
const CARET = 7

const SWATCH_CHECKER =
  'repeating-conic-gradient(rgba(140,140,140,0.32) 0% 25%, transparent 0% 50%) 50% / 8px 8px'

function Swatch({ color }: { color: string }): React.JSX.Element {
  return (
    <span
      className="relative size-3.5 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset ring-black/15 dark:ring-white/15"
      style={{ background: SWATCH_CHECKER }}
      aria-hidden="true"
    >
      {/* `background` (not backgroundColor) so gradient swatches render too. */}
      <span className="absolute inset-0" style={{ background: color }} />
    </span>
  )
}

function CopyRow({
  label,
  value,
  swatch
}: {
  label: string
  value: string
  swatch?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_RESET_MS)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className="group/row flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-foreground/[0.055]"
    >
      {swatch ? <Swatch color={swatch} /> : null}
      <span className="w-[4.25rem] shrink-0 text-[0.66rem] font-medium tracking-tight text-foreground/42">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem] tabular-nums text-foreground/82">
        {value}
      </span>
      <span className="grid size-4 shrink-0 place-items-center">
        {copied ? (
          <Check className="size-3 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy
            className="size-3 text-foreground/0 transition-colors group-hover/row:text-foreground/35"
            aria-hidden="true"
          />
        )}
      </span>
    </button>
  )
}

export function TokenTip({
  picked,
  containerRef,
  onClose
}: {
  picked: PickedElementRaw
  containerRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const tipRef = useRef<HTMLDivElement | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [pos, setPos] = useState<{
    top: number
    left: number
    side: 'left' | 'right'
    caretTop: number
  } | null>(null)

  const [drag, setDrag] = useState<{
    top: number
    left: number
    for: PickedElementRaw
  } | null>(null)
  const dragStart = useRef<{ x: number; y: number; top: number; left: number } | null>(null)
  const draggingRef = useRef(false)
  const lastDrag = useRef<{ top: number; left: number } | null>(null)
  const activeDrag = drag && drag.for === picked ? drag : null

  const groups = useMemo(
    () =>
      buildTokenGroups(picked, {
        color: t('browser.picker.groups.color'),
        typography: t('browser.picker.groups.typography'),
        layout: t('browser.picker.groups.layout'),
        spacing: t('browser.picker.groups.spacing'),
        border: t('browser.picker.groups.border'),
        effects: t('browser.picker.groups.effects'),
        textColor: t('browser.picker.fields.textColor'),
        background: t('browser.picker.fields.background'),
        gradient: t('browser.picker.fields.gradient'),
        borderColor: t('browser.picker.fields.borderColor'),
        fontFamily: t('browser.picker.fields.fontFamily'),
        fontSize: t('browser.picker.fields.fontSize'),
        fontWeight: t('browser.picker.fields.fontWeight'),
        lineHeight: t('browser.picker.fields.lineHeight'),
        letterSpacing: t('browser.picker.fields.letterSpacing'),
        textAlign: t('browser.picker.fields.textAlign'),
        textTransform: t('browser.picker.fields.textTransform'),
        display: t('browser.picker.fields.display'),
        flexDirection: t('browser.picker.fields.flexDirection'),
        justifyContent: t('browser.picker.fields.justifyContent'),
        alignItems: t('browser.picker.fields.alignItems'),
        padding: t('browser.picker.fields.padding'),
        margin: t('browser.picker.fields.margin'),
        gap: t('browser.picker.fields.gap'),
        borderWidth: t('browser.picker.fields.borderWidth'),
        borderStyle: t('browser.picker.fields.borderStyle'),
        borderRadius: t('browser.picker.fields.borderRadius'),
        opacity: t('browser.picker.fields.opacity'),
        boxShadow: t('browser.picker.fields.boxShadow'),
        filter: t('browser.picker.fields.filter'),
        backdropFilter: t('browser.picker.fields.backdropFilter'),
        transform: t('browser.picker.fields.transform')
      }),
    [picked, t]
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    const tip = tipRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const th = tip?.offsetHeight ?? 240
    const a = picked.anchor

    let side: 'left' | 'right' = 'right'
    let left = a.right + GAP
    if (left + TIP_WIDTH + MARGIN > cw) {
      side = 'left'
      left = a.left - GAP - TIP_WIDTH
    }
    left = Math.max(MARGIN, Math.min(left, cw - TIP_WIDTH - MARGIN))

    const elCenter = (a.top + a.bottom) / 2
    let top = elCenter - th / 2
    top = Math.max(MARGIN, Math.min(top, ch - th - MARGIN))

    const caretTop = Math.max(CARET + 4, Math.min(elCenter - top, th - CARET - 4))
    setPos({ top, left, side, caretTop })
  }, [picked, containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      const tip = tipRef.current
      if (!tip) return
      setDrag((prev) => {
        if (!prev) return prev
        const left = Math.max(
          MARGIN,
          Math.min(prev.left, container.clientWidth - tip.offsetWidth - MARGIN)
        )
        const top = Math.max(
          MARGIN,
          Math.min(prev.top, container.clientHeight - tip.offsetHeight - MARGIN)
        )
        if (left === prev.left && top === prev.top) return prev
        return { ...prev, left, top }
      })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef])

  const copyAll = (): void => {
    const text = groups
      .map((g) => `${g.title}\n${g.tokens.map((tok) => `  ${tok.label}: ${tok.value}`).join('\n')}`)
      .join('\n\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), COPY_RESET_MS)
    })
  }

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current
    const tip = tipRef.current
    if (!container || !tip) return
    e.preventDefault()
    const tipRect = tip.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      top: tipRect.top - containerRect.top,
      left: tipRect.left - containerRect.left
    }
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = dragStart.current
    const container = containerRef.current
    const tip = tipRef.current
    if (!start || !draggingRef.current || !container || !tip) return
    const left = Math.max(
      MARGIN,
      Math.min(start.left + (e.clientX - start.x), container.clientWidth - tip.offsetWidth - MARGIN)
    )
    const top = Math.max(
      MARGIN,
      Math.min(
        start.top + (e.clientY - start.y),
        container.clientHeight - tip.offsetHeight - MARGIN
      )
    )
    lastDrag.current = { top, left }

    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  }

  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    dragStart.current = null
    if (lastDrag.current) setDrag({ ...lastDrag.current, for: picked })
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const dims = `${picked.width}×${picked.height}`
  const resolvedTop = activeDrag?.top ?? pos?.top ?? picked.anchor.top
  const resolvedLeft = activeDrag?.left ?? pos?.left ?? picked.anchor.right + GAP

  return (
    <>
      {/* Highlight ring over the picked element. */}
      <div
        className="pointer-events-none absolute z-10 rounded-[3px] ring-[1.5px] ring-primary/80"
        style={{
          top: picked.anchor.top,
          left: picked.anchor.left,
          width: Math.max(0, picked.anchor.right - picked.anchor.left),
          height: Math.max(0, picked.anchor.bottom - picked.anchor.top),
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.22), 0 0 0 4px color-mix(in oklab, var(--primary) 16%, transparent)'
        }}
        aria-hidden="true"
      />

      <div
        ref={tipRef}
        role="dialog"
        aria-label={t('browser.picker.pick')}
        className={cn(
          'absolute z-20 flex flex-col overflow-hidden rounded-[13px]',
          'border border-border/60 bg-popover/80 text-popover-foreground backdrop-blur-2xl',
          'shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_16px_48px_-12px_rgba(0,0,0,0.5)]',
          'duration-150 ease-out animate-in fade-in-0 zoom-in-95',
          pos?.side === 'left'
            ? 'origin-right slide-in-from-right-1'
            : 'origin-left slide-in-from-left-1'
        )}
        style={{
          width: TIP_WIDTH,
          top: resolvedTop,
          left: resolvedLeft,
          visibility: pos ? 'visible' : 'hidden'
        }}
      >
        {/* Caret pointing back at the element — hidden once the tip is dragged. */}
        {pos && !activeDrag ? (
          <span
            className="pointer-events-none absolute z-10 size-[10px] rotate-45 border-border/60 bg-popover/80 backdrop-blur-2xl"
            style={
              {
                top: pos.caretTop - CARET / 2,
                [pos.side === 'left' ? 'right' : 'left']: -CARET / 2,
                borderTopWidth: pos.side === 'left' ? 0 : 1,
                borderRightWidth: pos.side === 'left' ? 1 : 0,
                borderBottomWidth: pos.side === 'left' ? 1 : 0,
                borderLeftWidth: pos.side === 'left' ? 0 : 1
              } as React.CSSProperties
            }
            aria-hidden="true"
          />
        ) : null}

        {/* Header doubles as the drag handle. */}
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          className="flex cursor-grab touch-none select-none items-center gap-1.5 px-2.5 pb-2 pt-2.5 active:cursor-grabbing"
        >
          <span className="grid h-5 shrink-0 place-items-center rounded-[5px] bg-primary/12 px-1.5 font-mono text-[0.64rem] font-semibold uppercase leading-none tracking-wide text-primary">
            {picked.tag}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[0.68rem] text-foreground/55">
            {picked.selector || picked.tag}
          </span>
          <span className="shrink-0 rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[0.62rem] tabular-nums text-foreground/50">
            {dims}
          </span>
        </div>

        {/* Token groups — each a tinted card; separation by spacing, not lines. */}
        <div className="flex max-h-[min(68vh,400px)] flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
          {groups.map((group) => (
            <div
              key={group.title}
              className="flex flex-col rounded-[9px] bg-foreground/[0.035] p-1"
            >
              <p className="px-1.5 pb-0.5 pt-1 text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-foreground/35">
                {group.title}
              </p>
              {group.tokens.map((tok) => (
                <CopyRow
                  key={group.title + tok.label}
                  label={tok.label}
                  value={tok.value}
                  swatch={tok.swatch}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
          <button
            type="button"
            onClick={copyAll}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground/[0.04] text-[0.7rem] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/85"
          >
            {copiedAll ? (
              <>
                <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
                {t('browser.picker.copied')}
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden="true" />
                {t('browser.picker.copyAll')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('browser.picker.closePanel')}
            className="grid size-7 shrink-0 place-items-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/80"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  )
}
