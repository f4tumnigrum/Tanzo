import { useState } from 'react'
import type { FileUIPart } from 'ai'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function ComposerAttachment({
  part,
  onRemove,
  removeLabel,
  imageTitle
}: {
  part: FileUIPart
  onRemove: () => void
  removeLabel: string
  imageTitle: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="group/att relative size-16">
        <DialogTrigger
          render={(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              onKeyDown={(event) => {
                if (event.key === 'Backspace' || event.key === 'Delete') {
                  event.preventDefault()
                  onRemove()
                }
              }}
              className={cn(
                'size-full overflow-hidden rounded-[var(--radius-lg)] border border-border/60 bg-muted/40 transition',
                'hover:border-border focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none'
              )}
            >
              <img src={part.url} alt={part.filename ?? ''} className="size-full object-cover" />
            </button>
          )}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-foreground/70 opacity-0 shadow-sm transition hover:text-foreground group-hover/att:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      </div>
      <DialogContent
        showCloseButton={false}
        className="flex h-screen max-h-screen w-screen max-w-screen items-center justify-center border-0 bg-transparent p-6 ring-0 sm:max-w-screen"
        onClick={() => setOpen(false)}
      >
        <DialogTitle className="sr-only">{part.filename ?? imageTitle}</DialogTitle>
        <img
          src={part.url}
          alt={part.filename ?? ''}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full rounded-[var(--radius-lg)] object-contain shadow-2xl"
        />
      </DialogContent>
    </Dialog>
  )
}
