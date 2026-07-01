import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant'
}

export function Message({ className, from, ...props }: MessageProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'group/msg flex w-full items-start gap-3 py-3',
        from === 'user' ? 'is-user justify-end' : 'is-assistant justify-start',
        className
      )}
      {...props}
    />
  )
}

const messageContentVariants = cva('flex flex-col gap-2 overflow-hidden text-sm', {
  variants: {
    variant: {
      contained: [
        'max-w-[94%] rounded-[var(--radius-lg)] px-3 py-2.5 @md/chat:max-w-[80%] @md/chat:px-4 @md/chat:py-3',
        'group-[.is-user]/msg:bg-primary group-[.is-user]/msg:text-primary-foreground',
        'group-[.is-assistant]/msg:bg-secondary group-[.is-assistant]/msg:text-foreground'
      ],
      flat: [
        'group-[.is-user]/msg:rounded-[var(--radius-lg)] group-[.is-user]/msg:bg-muted group-[.is-user]/msg:px-4 group-[.is-user]/msg:py-3',
        'group-[.is-user]/msg:text-foreground group-[.is-user]/msg:dark:bg-muted/80',
        'group-[.is-assistant]/msg:text-foreground'
      ]
    },
    defaultVariants: {
      variant: 'contained'
    }
  }
})

type MessageContentProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof messageContentVariants>

export function MessageContent({
  children,
  className,
  variant,
  ...props
}: MessageContentProps): React.JSX.Element {
  return (
    <div className={cn(messageContentVariants({ variant, className }))} {...props}>
      {children}
    </div>
  )
}
