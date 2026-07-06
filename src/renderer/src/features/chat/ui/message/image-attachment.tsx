import { useState } from 'react'
import type { FileUIPart } from 'ai'
import { FileText, ImageIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function formatBytes(url: string): string | null {
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const base64 = url.slice(comma + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((base64.length * 3) / 4) - padding
  if (bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImageAttachment({
  part,
  className
}: {
  part: FileUIPart
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const isImage = part.mediaType.startsWith('image/')
  const label = part.filename || part.mediaType.replace('image/', '').toUpperCase()
  const size = formatBytes(part.url)

  if (!isImage) {
    return (
      <span
        className={cn(
          'inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border/60 bg-card/60 py-1 pr-3 pl-2 backdrop-blur-sm',
          className
        )}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <span className="truncate text-[0.75rem] font-medium text-foreground/90">{label}</span>
        {size ? (
          <span className="shrink-0 text-[0.625rem] text-muted-foreground/60">{size}</span>
        ) : null}
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className={cn(
              'group/att inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border/60 bg-card/60 py-1 pr-3 pl-2 text-left backdrop-blur-sm transition',
              'hover:border-border hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              className
            )}
          >
            <ImageIcon
              className="size-3.5 shrink-0 text-muted-foreground transition group-hover/att:text-foreground"
              strokeWidth={1.8}
            />
            <span className="truncate text-[0.75rem] font-medium text-foreground/90">{label}</span>
            {size ? (
              <span className="shrink-0 text-[0.625rem] text-muted-foreground/60">{size}</span>
            ) : null}
          </button>
        )}
      />
      <DialogContent
        showCloseButton={false}
        className="flex h-screen max-h-screen w-screen max-w-screen items-center justify-center border-0 bg-transparent p-6 ring-0 sm:max-w-screen"
        onClick={() => setOpen(false)}
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>
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
