import { ArrowUp, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { composeSurfaceClass } from '@/features/chat/ui/compose/surface-style'
import { cn } from '@/lib/utils'

interface QuickInputBubbleProps {
  onSubmit: (text: string) => void
  onClose: () => void
}

export function QuickInputBubble({ onSubmit, onClose }: QuickInputBubbleProps): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)

  const canSubmit = text.trim().length > 0

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
    onClose()
  }

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  return (
    <div
      className={cn(
        'not-prose group relative flex w-[min(320px,calc(100vw-2rem))] flex-col overflow-hidden',
        'rounded-[var(--radius-xl)]',
        composeSurfaceClass,
        'bg-card',
        'backdrop-blur-xl backdrop-saturate-[1.6]',
        'transition-[background-color,border-color,box-shadow] duration-200 ease-out'
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 z-10 size-5 shrink-0 text-muted-foreground/68 hover:text-foreground"
        aria-label={t('common.actions.cancel')}
        onClick={onClose}
      >
        <X className="size-3" />
      </Button>

      <div className="scrollbar-none relative max-h-[160px] flex-1 overflow-y-auto">
        <Textarea
          ref={textareaRef}
          autoFocus
          variant="bare"
          value={text}
          rows={1}
          placeholder={t('pet.quickInput.placeholder')}
          className="min-h-[36px] px-4 pt-3 pr-8 pb-2 text-base text-foreground"
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          onKeyDown={(event) => {
            const composing = isComposingRef.current || event.nativeEvent.isComposing
            if (event.key === 'Escape') {
              onClose()
              return
            }
            if (event.key !== 'Enter' || event.shiftKey || composing) return
            event.preventDefault()
            submit()
          }}
        />
      </div>

      <div className="flex items-center justify-end px-3 pb-2">
        <Tooltip>
          <TooltipTrigger
            render={(triggerProps) => (
              <Button
                {...triggerProps}
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                aria-label={t('pet.quickInput.send')}
                size="icon-xs"
                className={cn(
                  'size-6 rounded-[var(--radius-4xl)] p-0',
                  'transition-all duration-150 focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:outline-none',
                  canSubmit
                    ? 'bg-foreground text-background shadow-xs hover:bg-foreground/92 active:scale-[0.96] active:bg-foreground/85'
                    : 'pointer-events-none bg-foreground/30 text-background/70 shadow-none'
                )}
              >
                <ArrowUp className="size-3.5" strokeWidth={2.15} />
              </Button>
            )}
          />
          <TooltipContent side="top">{t('pet.quickInput.sendShortcut')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
