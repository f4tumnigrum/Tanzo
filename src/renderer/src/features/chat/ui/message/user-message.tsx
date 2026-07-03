import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isFileUIPart, isTextUIPart } from 'ai'
import { ChevronDown } from 'lucide-react'
import type { TanzoUIMessage } from '@shared/agent-message'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDisclosure } from '../../model/use-disclosure'
import { Message, MessageContent } from './message'
import { MessageCopyButton } from './message-copy-button'
import { MessageEditButton } from './message-edit-button'
import { ImageAttachment } from './image-attachment'

const COLLAPSE_LINE_THRESHOLD = 10
const COLLAPSE_CHAR_THRESHOLD = 900
const COLLAPSED_HEIGHT = 240

export interface UserMessageProps {
  message: TanzoUIMessage
  onEdit?: (text: string) => void
  className?: string
}

export const UserMessage = memo(function UserMessage({
  message,
  onEdit,
  className
}: UserMessageProps): React.JSX.Element {
  const { t } = useTranslation()
  const parts = message.parts

  const copyText = useMemo(
    () =>
      parts
        .filter(isTextUIPart)
        .map((part) => part.text)
        .join('\n\n'),
    [parts]
  )

  const imageParts = useMemo(
    () => parts.filter(isFileUIPart).filter((part) => part.mediaType.startsWith('image/')),
    [parts]
  )

  const hasBubble = useMemo(() => parts.some((part) => isTextUIPart(part)), [parts])

  const canCollapse = useMemo(() => {
    const trimmed = copyText.trim()
    if (!trimmed) return false
    return (
      trimmed.split(/\r?\n/).length > COLLAPSE_LINE_THRESHOLD ||
      trimmed.length > COLLAPSE_CHAR_THRESHOLD
    )
  }, [copyText])

  const contentRef = useRef<HTMLDivElement | null>(null)
  const [measuredHeight, setMeasuredHeight] = useState(0)
  const [expanded, setExpanded] = useDisclosure(`usermsg:${message.id}`, false)

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(copyText)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = (): void => setMeasuredHeight(el.scrollHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [copyText])

  useEffect(() => {
    if (!isEditing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [isEditing])

  const startEditing = (): void => {
    setDraft(copyText)
    setIsEditing(true)
  }

  const cancelEditing = (): void => {
    setIsEditing(false)
    setDraft(copyText)
  }

  const submitEdit = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || !onEdit) {
      cancelEditing()
      return
    }
    setIsEditing(false)
    onEdit(trimmed)
  }

  const collapsed = canCollapse && !expanded

  if (isEditing) {
    return (
      <Message from="user" className={className}>
        <div className="flex w-full flex-col items-end gap-2">
          <MessageContent variant="contained" className="w-full max-w-[94%] @md/chat:max-w-[80%]">
            <Textarea
              ref={textareaRef}
              variant="bare"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  submitEdit()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEditing()
                }
              }}
              className="min-h-[3rem] text-[0.8125rem] leading-[var(--content-line-height)] text-primary-foreground"
              rows={Math.min(12, Math.max(2, draft.split('\n').length))}
            />
          </MessageContent>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelEditing}>
              {t('chat.message.edit.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={submitEdit} disabled={!draft.trim()}>
              {t('chat.message.edit.send')}
            </Button>
          </div>
        </div>
      </Message>
    )
  }

  return (
    <Message from="user" className={className}>
      <div className="flex w-full flex-col items-end gap-2">
        {hasBubble ? (
          <MessageContent variant="contained" className="w-fit max-w-[94%] @md/chat:max-w-[80%]">
            <div className="space-y-2">
              <div className="relative">
                <div
                  className="overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                  style={{
                    height: collapsed ? COLLAPSED_HEIGHT : measuredHeight || 'auto'
                  }}
                >
                  <div ref={contentRef} className="space-y-2">
                    {parts.map((part, index) => {
                      if (isTextUIPart(part)) {
                        return (
                          <p
                            key={`text-${index}`}
                            className="whitespace-pre-wrap break-words text-[0.8125rem] leading-[var(--content-line-height)]"
                          >
                            {part.text}
                          </p>
                        )
                      }
                      return null
                    })}
                  </div>
                </div>
                <div
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-primary to-transparent transition-opacity duration-200',
                    collapsed ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </div>
              {canCollapse ? (
                <div className="flex justify-center pt-0.5">
                  <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                    className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-primary-foreground/75 transition-colors duration-150 hover:text-primary-foreground focus-visible:outline-none"
                  >
                    <span>
                      {expanded
                        ? t('chat.message.userMessage.showLess')
                        : t('chat.message.userMessage.showMore')}
                    </span>
                    <ChevronDown
                      className={cn(
                        'size-3 transition-transform duration-200',
                        expanded && 'rotate-180'
                      )}
                      strokeWidth={2}
                    />
                  </button>
                </div>
              ) : null}
            </div>
          </MessageContent>
        ) : null}

        {imageParts.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {imageParts.map((part, index) => (
              <ImageAttachment key={`image-${index}`} part={part} />
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            'mt-1.5 flex items-center gap-1.5',
            'opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100'
          )}
        >
          {onEdit ? <MessageEditButton onEdit={startEditing} /> : null}
          <MessageCopyButton text={copyText} />
        </div>
      </div>
    </Message>
  )
})
