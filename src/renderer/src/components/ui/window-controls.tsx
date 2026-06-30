import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type Platform = 'darwin' | 'win32' | 'linux' | 'unknown'

const ICON_PROPS = {
  viewBox: '0 0 12 12',
  className: 'size-full'
} as const

const ICON_PATH = {
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round'
} as const

const ICONS = {
  close: <path {...ICON_PATH} d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" />,
  minimize: <path {...ICON_PATH} d="M3 6H9" />,
  maximize: <path {...ICON_PATH} d="M3 6H9M6 3V9" />
} as const

interface ButtonSpec {
  key: 'close' | 'minimize' | 'maximize'
  color: string
  iconColor: string
  ariaKey: keyof typeof ariaMap
  onPress: () => void
}

const ariaMap = {
  close: 'common.window.close',
  minimize: 'common.window.minimize',
  maximize: 'common.window.maximize',
  restore: 'common.window.restore'
} as const

/**
 * Single source of truth for whether the custom traffic-light overlay renders
 * on this platform. macOS hides its native buttons and Windows is frameless, so
 * both draw the custom controls; Linux keeps its native frame and draws nothing.
 * Anything that needs to reserve space for the overlay (e.g. a header inset)
 * should gate on this so it never reserves space where no controls exist.
 */
export function useWindowControlsVisible(): boolean {
  const [platform, setPlatform] = useState<Platform>('unknown')
  const controls = window.electron?.windowControls

  useEffect(() => {
    if (!controls) return
    let active = true
    void window.electron?.getPlatform().then((info) => {
      if (active) setPlatform(info.platform as Platform)
    })
    return () => {
      active = false
    }
  }, [controls])

  return Boolean(controls) && (platform === 'darwin' || platform === 'win32')
}

export function WindowControls({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const controls = window.electron?.windowControls
  const visible = useWindowControlsVisible()

  useEffect(() => {
    if (!controls) return
    let active = true

    const sync = () => {
      void controls.isMaximized().then((value) => {
        if (active) setMaximized(value)
      })
    }
    sync()
    window.addEventListener('resize', sync)

    return () => {
      active = false
      window.removeEventListener('resize', sync)
    }
  }, [controls])

  if (!controls || !visible) return null

  const buttons: ButtonSpec[] = [
    {
      key: 'close',
      color: '#ff5f57',
      iconColor: '#5c1010',
      ariaKey: 'close',
      onPress: () => void controls.close()
    },
    {
      key: 'minimize',
      color: '#ffbd2e',
      iconColor: '#6f4a00',
      ariaKey: 'minimize',
      onPress: () => void controls.minimize()
    },
    {
      key: 'maximize',
      color: '#28c840',
      iconColor: '#0f5f23',
      ariaKey: maximized ? 'restore' : 'maximize',
      onPress: () =>
        void controls.toggleMaximize().then((value) => {
          setMaximized(value)
        })
    }
  ]

  return (
    <div className={cn('app-no-drag group/window-controls flex items-center gap-2.5', className)}>
      {buttons.map(({ key, color, iconColor, ariaKey, onPress }) => (
        <button
          key={key}
          type="button"
          onClick={onPress}
          aria-label={t(ariaMap[ariaKey])}
          className="app-no-drag relative grid size-4 place-items-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span
            className="absolute inset-0 rounded-full bg-muted-foreground/20 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.12)] transition-all duration-200 group-hover/window-controls:bg-[var(--dot-color)] dark:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.08)]"
            style={{ ['--dot-color' as string]: color }}
          />
          <span
            className="relative z-10 size-2.5 scale-75 opacity-0 transition-all duration-200 group-hover/window-controls:scale-100 group-hover/window-controls:opacity-100"
            style={{ color: iconColor }}
          >
            <svg {...ICON_PROPS}>{ICONS[key]}</svg>
          </span>
        </button>
      ))}
    </div>
  )
}
