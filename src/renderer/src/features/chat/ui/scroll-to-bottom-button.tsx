import { ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LiquidGlass } from '@/components/ui/liquid-glass'
import { cn } from '@/lib/utils'

export interface ScrollToBottomButtonProps {
  visible: boolean
  onClick: () => void
  className?: string
}

export function ScrollToBottomButton({
  visible,
  onClick,
  className
}: ScrollToBottomButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'pointer-events-auto z-30 transition-all duration-200',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        className
      )}
    >
      <LiquidGlass className="rounded-full shadow-md!">
        <button
          type="button"
          onClick={onClick}
          aria-label={t('chat.message.scrollToBottom')}
          className={cn(
            'flex size-8 items-center justify-center rounded-full',
            'text-foreground/85 transition-all duration-150',
            'hover:bg-foreground/[0.06] hover:text-foreground',
            'active:scale-[0.94]',
            'focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:outline-none'
          )}
        >
          <ArrowDown className="size-3.5" strokeWidth={2} />
        </button>
      </LiquidGlass>
    </div>
  )
}
