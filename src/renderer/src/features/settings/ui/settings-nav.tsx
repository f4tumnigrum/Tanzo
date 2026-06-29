import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppShellStore } from '@/app/app-shell-store'
import { SETTINGS_SECTIONS } from '../model'

export interface SettingsNavProps {
  className?: string
}

export function SettingsNav({ className }: SettingsNavProps): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const activeSection = useAppShellStore((state) => state.settingsSection)
  const setSection = useAppShellStore((state) => state.setSettingsSection)

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header className="flex shrink-0 items-center gap-1.5 px-3 pt-3 pb-2">
        <button
          type="button"
          className={cn(
            'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)]',
            'bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] dark:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]',
            'text-sm text-foreground/65',
            'hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground dark:hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]',
            'active:bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)]',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          )}
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="size-3" />
          {t('common.actions.back')}
        </button>
      </header>
      <nav className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = section.id === activeSection
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setSection(section.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5',
                'text-[0.8125rem] tracking-[0.01em]',
                'transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isActive
                  ? 'bg-[var(--sidebar-item-active-bg)] text-sidebar-foreground'
                  : 'text-sidebar-foreground/72 hover:bg-[var(--sidebar-item-hover-bg)] hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0 opacity-80" />
              <span className="truncate">
                {t(section.labelKey, { defaultValue: section.defaultLabel })}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
