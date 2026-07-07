import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface ProgressRingProps extends Omit<ComponentProps<'svg'>, 'children'> {
  value: number

  strokeWidth?: number
}

export function ProgressRing({
  value,
  strokeWidth = 3,
  className,
  ...props
}: ProgressRingProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value))
  const radius = 12 - strokeWidth / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <svg
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      viewBox="0 0 24 24"
      className={cn('size-4', className)}
      {...props}
    >
      <circle
        cx={12}
        cy={12}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-20"
      />
      <circle
        cx={12}
        cy={12}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 12 12)"
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  )
}
