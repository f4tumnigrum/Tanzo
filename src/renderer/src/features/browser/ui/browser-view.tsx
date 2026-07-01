import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Lock,
  Maximize2,
  Minimize2,
  MousePointerSquareDashed,
  Plus,
  RotateCw,
  TriangleAlert,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pageHeaderIconBtnCls } from '@/components/layout/page-header'
import { cn } from '@/lib/utils'
import { useBrowserUiStore, type BrowserTab } from '../model/store'
import { normalizeAddressInput } from '../model/normalize-url'
import { getPickerScript, getStopScript, type PickedElementRaw } from '../model/pick-element'
import { TokenTip } from './token-panel'
import type { WebviewElement } from '../webview'

const PARTITION = 'embedded-browser'

export function ToolbarButton({
  label,
  onClick,
  disabled,
  active,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              pageHeaderIconBtnCls,
              active && 'bg-primary/15 text-primary hover:bg-primary/20'
            )}
            onClick={onClick}
            disabled={disabled}
            aria-pressed={active}
            aria-label={label}
          >
            {children}
          </Button>
        )}
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A single browser tab: owns one `<webview>` and all of its navigation, picker
 * and error state. Stays mounted while inactive (hidden by the parent) so the
 * page, scroll position and history survive tab switches. Live metadata (url,
 * title, loading) is pushed up to the store so the tab strip can render it.
 */
export function BrowserView({ tab }: { tab: BrowserTab }): React.JSX.Element {
  const { t } = useTranslation()
  const setMaximized = useBrowserUiStore((s) => s.setMaximized)
  const maximized = useBrowserUiStore((s) => s.maximized)
  const toggleMaximized = useBrowserUiStore((s) => s.toggleMaximized)
  const setOpen = useBrowserUiStore((s) => s.setOpen)
  const updateTab = useBrowserUiStore((s) => s.updateTab)
  const newTab = useBrowserUiStore((s) => s.newTab)

  const webviewRef = useRef<WebviewElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const tabId = tab.id

  const [address, setAddress] = useState(tab.initialUrl)
  const [pageUrl, setPageUrl] = useState(tab.initialUrl)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<{ code: number; url: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElementRaw | null>(null)
  const [navSeq, setNavSeq] = useState(0)

  // Wire guest navigation events to local chrome state and the store.
  useEffect(() => {
    const view = webviewRef.current
    if (!view) return undefined

    const syncNav = (): void => {
      setCanGoBack(view.canGoBack())
      setCanGoForward(view.canGoForward())
    }
    const handleReady = (): void => {
      setNavSeq((n) => n + 1)
      syncNav()
    }
    const handleNavigate = (event: Event): void => {
      const url = (event as unknown as { url?: string }).url
      if (typeof url === 'string') {
        setAddress(url)
        setPageUrl(url)
        updateTab(tabId, { url })
      }
      setLoadError(null)
      syncNav()
    }
    const handleTitle = (event: Event): void => {
      const title = (event as unknown as { title?: string }).title
      if (typeof title === 'string') {
        updateTab(tabId, { title })
      }
    }
    const handleStart = (): void => {
      setLoading(true)
      setLoadError(null)
      updateTab(tabId, { loading: true })
    }
    const handleStop = (): void => {
      setLoading(false)
      updateTab(tabId, { loading: false })
      syncNav()
    }
    // `did-fail-load` fires for aborts too; ignore ERR_ABORTED (-3) and
    // sub-frame failures so only real main-frame errors surface.
    const handleFail = (event: Event): void => {
      const e = event as unknown as {
        errorCode?: number
        validatedURL?: string
        isMainFrame?: boolean
      }
      setLoading(false)
      updateTab(tabId, { loading: false })
      if (e.isMainFrame === false || e.errorCode === -3) return
      setLoadError({ code: e.errorCode ?? 0, url: e.validatedURL ?? '' })
    }

    view.addEventListener('dom-ready', handleReady)
    view.addEventListener('did-navigate', handleNavigate)
    view.addEventListener('did-navigate-in-page', handleNavigate)
    view.addEventListener('page-title-updated', handleTitle)
    view.addEventListener('did-start-loading', handleStart)
    view.addEventListener('did-stop-loading', handleStop)
    view.addEventListener('did-fail-load', handleFail)
    return () => {
      view.removeEventListener('dom-ready', handleReady)
      view.removeEventListener('did-navigate', handleNavigate)
      view.removeEventListener('did-navigate-in-page', handleNavigate)
      view.removeEventListener('page-title-updated', handleTitle)
      view.removeEventListener('did-start-loading', handleStart)
      view.removeEventListener('did-stop-loading', handleStop)
      view.removeEventListener('did-fail-load', handleFail)
    }
  }, [tabId, updateTab])

  // Navigation actions must work even while a previous page is still loading
  // (or stuck). `loadURL` only throws before the webview is attached to the DOM,
  // not mid-load, so guard on attachment (`isConnected`) rather than the
  // first-`dom-ready` `ready` flag — otherwise a never-loading page would wedge
  // the address bar. Wrapped in try/catch because the throw is synchronous.
  const callView = useCallback((fn: (view: WebviewElement) => void): void => {
    const view = webviewRef.current
    if (!view || !view.isConnected) return
    try {
      fn(view)
    } catch {
      // Webview not attached yet; ignore.
    }
  }, [])

  const submitAddress = useCallback(
    (event: React.FormEvent): void => {
      event.preventDefault()
      const normalized = normalizeAddressInput(address)
      if (!normalized) return
      setAddress(normalized)
      callView((view) => void view.loadURL(normalized).catch(() => undefined))
    },
    [address, callView]
  )

  const goBack = useCallback(() => callView((view) => view.goBack()), [callView])
  const goForward = useCallback(() => callView((view) => view.goForward()), [callView])
  const reload = useCallback(() => callView((view) => view.reload()), [callView])

  // Pick mode is a toggle. The button flips `picking`; this effect owns the
  // whole session. While on, it re-injects the picker after each selection so
  // the user can sample several elements without re-arming. The guest has no
  // preload, so it runs entirely through executeJavaScript: each injection
  // resolves with the clicked element's computed style, or null on Esc — which
  // exits pick mode. Turning the toggle off (or unmounting) runs the stop hook.
  useEffect(() => {
    if (!picking) return undefined
    const view = webviewRef.current
    if (!view) {
      setPicking(false)
      return undefined
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const run = (code: string): Promise<unknown> => {
      if (!view.isConnected) return Promise.reject(new Error('detached'))
      try {
        return view.executeJavaScript(code, true)
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    const loop = (): void => {
      if (cancelled) return
      void run(getPickerScript())
        .then((result) => {
          if (cancelled) return
          if (result && typeof result === 'object') {
            setPicked(result as PickedElementRaw)
            loop()
          } else {
            setPicking(false)
          }
        })
        .catch(() => {
          if (cancelled) return
          retryTimer = setTimeout(loop, 150)
        })
    }
    loop()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      void run(getStopScript()).catch(() => undefined)
    }
  }, [picking, navSeq])

  const togglePicking = useCallback((): void => {
    setPicking((prev) => !prev)
  }, [])

  const isSecure = /^https:\/\//i.test(pageUrl)

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex items-center gap-0.5 border-b border-border/40 px-2 py-1.5">
        <ToolbarButton label={t('browser.back')} onClick={goBack} disabled={!canGoBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label={t('browser.forward')} onClick={goForward} disabled={!canGoForward}>
          <ArrowRight className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label={t('browser.reload')} onClick={reload}>
          <RotateCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label={picking ? t('browser.picker.picking') : t('browser.picker.pick')}
          onClick={togglePicking}
          active={picking}
        >
          <MousePointerSquareDashed className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label={t('browser.tabs.new')} onClick={() => newTab()}>
          <Plus className="size-4" aria-hidden="true" />
        </ToolbarButton>

        <form onSubmit={submitAddress} className="mx-1 min-w-0 flex-1">
          <div className="group/address flex h-8 items-center gap-2 rounded-[var(--radius-lg)] border border-border/40 bg-secondary px-2.5 transition-colors focus-within:border-border/70">
            {isSecure ? (
              <Lock className="size-3.5 shrink-0 text-emerald-500/70" aria-hidden="true" />
            ) : (
              <Globe
                className="size-3.5 shrink-0 text-foreground/40 group-focus-within/address:text-foreground/60"
                aria-hidden="true"
              />
            )}
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('browser.address')}
              placeholder={t('browser.addressPlaceholder')}
              className="!h-auto !min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-0 !shadow-none !ring-0 text-[0.75rem] tracking-[0.01em] text-foreground/82 placeholder:text-foreground/35 focus-visible:!border-0 focus-visible:!ring-0 focus-visible:!ring-offset-0"
            />
            {address ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setAddress('')}
                aria-label={t('browser.clear')}
                className="size-5 shrink-0 rounded-[var(--radius-md)] border-0 bg-transparent text-foreground/35 shadow-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground/60"
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </form>

        <ToolbarButton
          label={maximized ? t('browser.restore') : t('browser.maximize')}
          onClick={toggleMaximized}
        >
          {maximized ? (
            <Minimize2 className="size-4" aria-hidden="true" />
          ) : (
            <Maximize2 className="size-4" aria-hidden="true" />
          )}
        </ToolbarButton>
        <ToolbarButton
          label={t('browser.close')}
          onClick={() => {
            setMaximized(false)
            setOpen(false)
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </ToolbarButton>
      </div>
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {/* `partition` is an Electron webview attr unknown to React's DOM typings.
            Popups are denied in the main process (setWindowOpenHandler). */}
        <webview
          ref={webviewRef}
          src={tab.initialUrl}
          className="absolute inset-0 h-full w-full"
          {...({ partition: PARTITION } as Record<string, string>)}
        />
        {picked ? (
          <TokenTip picked={picked} containerRef={viewportRef} onClose={() => setPicked(null)} />
        ) : null}
        {loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 px-6 text-center backdrop-blur-sm">
            <TriangleAlert className="size-7 text-foreground/40" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground/80">{t('browser.error.title')}</p>
              <p className="max-w-sm truncate text-xs text-foreground/45">
                {loadError.url || address}
              </p>
              <p className="text-xs text-foreground/35">
                {t('browser.error.code', { code: loadError.code })}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoadError(null)
                reload()
              }}
              className="gap-1.5"
            >
              <RotateCw className="size-3.5" aria-hidden="true" />
              {t('browser.error.retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
