import React, { forwardRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Card as UiCard,
  CardContent as UiCardContent,
  CardDescription as UiCardDescription,
  CardFooter as UiCardFooter,
  CardTitle as UiCardTitle
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface FeatureCardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  active?: boolean
  disabled?: boolean
  minHeight?: string
}

export const FeatureCard = forwardRef<HTMLDivElement, FeatureCardProps>(function FeatureCard(
  {
    className,
    children,
    interactive = true,
    active = false,
    disabled = false,
    minHeight = 'min-h-[116px]',
    ...props
  },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'group/feature-card relative isolate overflow-hidden rounded-xl border border-foreground/15',
        interactive && !disabled && ['cursor-pointer', 'hover:border-foreground/25'],
        active && 'border-foreground/25',
        disabled && 'opacity-50',
        className
      )}
      {...props}
    >
      <UiCard
        className={cn(
          'relative overflow-hidden rounded-[11px] gap-0 py-0 border-0 ring-0',
          'transition-[background-color,box-shadow] duration-200 ease-out',
          minHeight,
          'bg-secondary shadow-xs backdrop-blur-xl backdrop-saturate-150',
          interactive && !disabled && ['hover:shadow-sm', 'active:shadow-xs'],
          active && 'bg-[color-mix(in_oklab,var(--secondary)_65%,var(--background))]'
        )}
      >
        <UiCardContent className="relative z-10 flex h-full flex-col px-3 pt-3 pb-2">
          {children}
        </UiCardContent>
      </UiCard>
    </div>
  )
})
FeatureCard.displayName = 'FeatureCard'

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  badge?: React.ReactNode
  actions?: React.ReactNode
}

export function CardHeader({ title, badge, actions, children, className }: CardHeaderProps) {
  const stopCardClickPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <UiCardTitle className="min-w-0 truncate text-sm leading-tight">{title}</UiCardTitle>
          {badge}
        </div>
        {actions ? (
          <div
            className="flex shrink-0 items-center"
            onClick={stopCardClickPropagation}
            onMouseDown={stopCardClickPropagation}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function CardDescription({
  children,
  className,
  ...props
}: React.ComponentProps<typeof UiCardDescription>) {
  return (
    <UiCardDescription
      className={cn(
        'mt-1 line-clamp-2 min-h-[2lh] text-xs leading-[1.45] text-muted-foreground/90',
        className
      )}
      {...props}
    >
      {children}
    </UiCardDescription>
  )
}

export function CardDivider() {
  return (
    <div className="my-2">
      <Separator className="bg-gradient-to-r from-transparent via-border/50 to-transparent" />
    </div>
  )
}

interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  showArrow?: boolean
}

export function CardFooter({ children, showArrow = true, className }: CardFooterProps) {
  return (
    <UiCardFooter className={cn('min-h-5 justify-between gap-2 px-0 pt-0 pb-0', className)}>
      <div className={cn('flex items-center gap-1.5', !showArrow && 'w-full')}>{children}</div>
      {showArrow && (
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/30 transition-all group-hover/feature-card:translate-x-0.5 group-hover/feature-card:text-muted-foreground/60" />
      )}
    </UiCardFooter>
  )
}

interface CardStatusBadgeProps {
  active: boolean
  activeIcon: React.ReactNode
  activeText: string
  inactiveText?: string
}

export function CardStatusBadge({
  active,
  activeIcon,
  activeText,
  inactiveText
}: CardStatusBadgeProps) {
  const { t } = useTranslation()
  const resolvedInactiveText = inactiveText ?? t('common.status.notConfigured')

  if (active) {
    return (
      <Badge className="h-4.5 gap-1.5 rounded-md border border-foreground bg-foreground px-2 hover:bg-foreground">
        {activeIcon}
        <span className="text-[0.625rem] font-semibold text-background">{activeText}</span>
      </Badge>
    )
  }

  return (
    <span className="text-[0.6875rem] font-medium text-muted-foreground">
      {resolvedInactiveText}
    </span>
  )
}
