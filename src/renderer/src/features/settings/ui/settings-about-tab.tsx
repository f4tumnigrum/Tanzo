import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, Copy, Download, RefreshCw } from 'lucide-react'
import type { ElectronPlatformInfo } from '@shared/system'
import tanzoWordmark from '@/assets/tanzo1.png'
import { systemClient } from '@/platform/electron/system-client'
import { useAppUpdate, formatBytes, formatSpeed, type AppUpdate } from '@/hooks/use-app-update'
import { ProgressRing } from '@/components/ui/progress-ring'
import { cn } from '@/lib/utils'

const REPO_URL = 'https://github.com/f4tumnigrum/Tanzo'
const ISSUES_URL = `${REPO_URL}/issues`

const OS_NAMES: Partial<Record<string, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

const TEXT_ACTION_CLASS = cn(
  'group inline-flex items-center gap-1 rounded-sm text-xs text-foreground/55',
  'transition-colors duration-150 hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
)

function Reveal({
  delay = 0,
  className,
  children
}: {
  delay?: number
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const style: CSSProperties = { animationDelay: `${delay}ms`, animationFillMode: 'backwards' }
  return (
    <div
      className={cn(
        'animate-in fade-in-0 slide-in-from-bottom-3 duration-500 ease-out',
        'motion-reduce:animate-none',
        className
      )}
      style={style}
    >
      {children}
    </div>
  )
}

function usePlatformInfo(): ElectronPlatformInfo | null {
  const [info, setInfo] = useState<ElectronPlatformInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    void systemClient
      .getPlatform()
      .then((value) => {
        if (!cancelled) setInfo(value)
      })
      .catch(() => {
        // Non-electron surface (tests, storybook): the hero simply omits the version.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return info
}

function UpdatePill({ update }: { update: AppUpdate }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, download, install } = update

  if (state.status === 'idle') return null

  const pillClass = cn(
    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs',
    'animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none'
  )

  if (state.status === 'checking') {
    return (
      <span className={cn(pillClass, 'border border-border/20 text-foreground/60')}>
        <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" />
        {t('settings.about.update.checking', { defaultValue: 'Checking for updates…' })}
      </span>
    )
  }

  if (state.status === 'available') {
    return (
      <button
        type="button"
        onClick={download}
        className={cn(
          pillClass,
          'border border-primary/25 bg-primary/[0.06] text-primary',
          'transition-colors duration-150 hover:bg-primary/[0.12]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        )}
      >
        <Download className="size-3.5" />
        {t('settings.about.update.available', {
          defaultValue: 'Update to {{version}}',
          version: state.version ?? ''
        })}
      </button>
    )
  }

  if (state.status === 'downloading') {
    const transferred = formatBytes(state.transferred)
    const total = formatBytes(state.total)
    const speed = formatSpeed(state.bytesPerSecond)
    const size = transferred && total ? t('update.progress.size', { transferred, total }) : null
    const detail = [size, speed].filter(Boolean).join(' · ')
    return (
      <span className={cn(pillClass, 'border border-border/20 text-foreground/60')}>
        <ProgressRing value={state.percent} className="size-3.5 text-foreground/70" />
        {t('settings.about.update.downloading', {
          defaultValue: 'Downloading… {{percent}}%',
          percent: state.percent
        })}
        {detail ? <span className="text-foreground/45">· {detail}</span> : null}
      </span>
    )
  }

  if (state.status === 'downloaded') {
    return (
      <button
        type="button"
        onClick={install}
        className={cn(
          pillClass,
          'border border-primary/25 bg-primary/[0.06] text-primary',
          'transition-colors duration-150 hover:bg-primary/[0.12]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        )}
      >
        <RefreshCw className="size-3.5" />
        {t('settings.about.update.ready', { defaultValue: 'Restart to update' })}
      </button>
    )
  }

  return (
    <span className={cn(pillClass, 'text-destructive/70')}>
      {t('settings.about.update.error', { defaultValue: 'Update check failed' })}
    </span>
  )
}

function SpecItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <dt className="text-[0.5625rem] font-medium tracking-[0.16em] text-foreground/35 uppercase">
        {label}
      </dt>
      <dd className="font-mono text-[0.6875rem] leading-none text-foreground/72">{value}</dd>
    </div>
  )
}

function Dot(): React.JSX.Element {
  return (
    <span aria-hidden className="text-[0.625rem] text-foreground/20 select-none">
      ·
    </span>
  )
}

export function SettingsAboutTab(): React.JSX.Element {
  const { t } = useTranslation()
  const platformInfo = usePlatformInfo()
  const versions = systemClient.processVersions()
  const update = useAppUpdate()
  const [copied, setCopied] = useState(false)

  const checkBusy = update.state.status === 'checking' || update.state.status === 'downloading'

  const osLabel = platformInfo
    ? `${OS_NAMES[platformInfo.platform] ?? platformInfo.platform} ${platformInfo.arch}`
    : undefined

  const specs: Array<[string, string | undefined]> = [
    ['Electron', versions.electron],
    ['Chromium', versions.chrome],
    ['Node', versions.node],
    ['OS', osLabel]
  ]

  const copyInfo = (): void => {
    const lines = [
      `Tanzo ${platformInfo?.version ?? '?'}`,
      ...specs
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([label, value]) => `${label} ${value}`)
    ]
    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      {/* Hero: wordmark, version */}
      <Reveal>
        <img
          src={tanzoWordmark}
          alt="Tanzo"
          draggable={false}
          className="h-auto w-full max-w-[9.5rem] object-contain opacity-85 select-none dark:opacity-70 dark:invert"
          style={{
            maskImage: 'radial-gradient(ellipse 85% 85% at center, black 40%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 85% 85% at center, black 40%, transparent 100%)'
          }}
        />
      </Reveal>

      <Reveal delay={70} className="mt-4 h-5">
        {platformInfo ? (
          <span className="bg-gradient-to-r from-primary to-primary/55 bg-clip-text font-mono text-sm font-medium tracking-[0.04em] text-transparent">
            v{platformInfo.version}
          </span>
        ) : null}
      </Reveal>

      <div className="mt-5 min-h-0 empty:hidden">
        <UpdatePill update={update} />
      </div>

      {/* Hairline ornament */}
      <Reveal delay={220} className="my-9">
        <div className="h-px w-20 bg-gradient-to-r from-transparent via-border/70 to-transparent" />
      </Reveal>

      {/* Spec sheet */}
      <Reveal delay={290}>
        <dl className="flex flex-wrap items-start justify-center gap-x-8 gap-y-4">
          {specs.map(([label, value]) =>
            value ? <SpecItem key={label} label={label} value={value} /> : null
          )}
        </dl>
      </Reveal>

      {/* Text actions */}
      <Reveal delay={360} className="mt-8">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={TEXT_ACTION_CLASS}>
            GitHub
            <ArrowUpRight className="size-3 opacity-45 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <Dot />
          <a href={ISSUES_URL} target="_blank" rel="noreferrer" className={TEXT_ACTION_CLASS}>
            {t('settings.about.links.issues', { defaultValue: 'Report an issue' })}
            <ArrowUpRight className="size-3 opacity-45 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          {update.available ? (
            <>
              <Dot />
              <button
                type="button"
                onClick={update.check}
                disabled={checkBusy}
                className={cn(TEXT_ACTION_CLASS, 'disabled:opacity-40')}
              >
                {t('settings.about.update.check', { defaultValue: 'Check for updates' })}
                <RefreshCw
                  className={cn(
                    'size-3 opacity-45 transition-opacity duration-150 group-hover:opacity-80',
                    checkBusy && 'animate-spin motion-reduce:animate-none'
                  )}
                />
              </button>
            </>
          ) : null}
          <Dot />
          <button
            type="button"
            onClick={copyInfo}
            className={cn(TEXT_ACTION_CLASS, copied && 'text-primary hover:text-primary')}
          >
            {copied
              ? t('settings.about.copied', { defaultValue: 'Copied' })
              : t('settings.about.copy', { defaultValue: 'Copy info' })}
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3 opacity-45 transition-opacity duration-150 group-hover:opacity-80" />
            )}
          </button>
        </div>
      </Reveal>

      {/* Footer */}
      <Reveal delay={430} className="mt-9">
        <p className="text-[0.625rem] tracking-[0.03em] text-foreground/30">
          {t('settings.about.license', { defaultValue: 'Released under the Apache-2.0 license' })}
          {' · © f4tumnigrum'}
        </p>
      </Reveal>
    </div>
  )
}
