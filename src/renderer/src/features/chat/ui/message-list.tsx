import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { TanzoUIMessage } from '@shared/agent-message'
import { MessageItem } from './message/message-item'
import { ScrollToBottomButton } from './scroll-to-bottom-button'

export interface MessageListProps {
  messages: ReadonlyArray<TanzoUIMessage>

  activeStreamingMessageId?: string | null

  isStreaming?: boolean

  composerOffset?: number

  streamFooter?: ReactNode

  onForkMessage?: (messageId: string) => void | Promise<void>

  editableMessageId?: string | null

  onEditMessage?: (messageId: string, text: string) => void

  threadId: string
  className?: string
}

/**
 * Distance (px) from the true bottom within which the list still counts as
 * "at bottom". Generous on purpose so that per-frame streaming growth cannot
 * flip the state off before the follow-up re-pin lands.
 */
const BOTTOM_EPSILON = 48

/**
 * Plain scroller — no virtualization. Off-screen messages are skipped by the
 * compositor via `content-visibility: auto`, which is enough for
 * conversation-sized lists and removes the whole class of measurement /
 * scroll-correction bugs a virtualizer brings.
 *
 * Sticky-bottom is a single writer: a ResizeObserver on the content box
 * re-pins `scrollTop` whenever content grows while the user is at the bottom.
 * Native scroll anchoring is disabled (`overflow-anchor: none`) so the
 * browser never competes with that writer.
 */
export const MessageList = memo(function MessageList({
  messages,
  activeStreamingMessageId,
  isStreaming = false,
  composerOffset = 24,
  streamFooter,
  onForkMessage,
  editableMessageId,
  onEditMessage,
  threadId,
  className
}: MessageListProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  // Threads open pinned to the bottom, so start true.
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const syncAtBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const next =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_EPSILON
    atBottomRef.current = next
    setAtBottom(next)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior })
  }, [])

  // Open at the bottom whenever the thread changes.
  useLayoutEffect(() => {
    atBottomRef.current = true
    setAtBottom(true)
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [threadId])

  // Sticky-bottom: whenever the content box changes size (streamed tokens,
  // images, syntax-highlight reflow, footer changes, `content-visibility`
  // estimate corrections) while the user is at the bottom, re-pin. Scrolling
  // away flips `atBottomRef` via the scroll handler, which silences the pin.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [threadId])

  return (
    <div className={cn('relative h-full min-h-0 w-full', className)}>
      <div
        ref={scrollerRef}
        onScroll={syncAtBottom}
        className="scrollbar-subtle h-full overflow-y-auto [overflow-anchor:none]"
      >
        <div ref={contentRef} className="flex min-h-full flex-col justify-end">
          {messages.map((message) => (
            <div
              key={message.id}
              className="mx-auto w-full max-w-3xl px-3 @md/chat:px-5 [content-visibility:auto] [contain-intrinsic-size:auto_150px]"
            >
              <MessageItem
                message={message}
                isStreaming={isStreaming && message.id === activeStreamingMessageId}
                {...(onForkMessage ? { onFork: () => onForkMessage(message.id) } : {})}
                {...(onEditMessage && message.id === editableMessageId
                  ? { onEdit: (text: string) => onEditMessage(message.id, text) }
                  : {})}
              />
            </div>
          ))}
          {streamFooter ? (
            <div className="mx-auto w-full max-w-3xl px-3 @md/chat:px-5">{streamFooter}</div>
          ) : null}
          <div style={{ height: composerOffset }} />
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 flex justify-center"
        style={{ bottom: composerOffset + 12 }}
      >
        <ScrollToBottomButton
          visible={!atBottom && messages.length > 0}
          onClick={() => scrollToBottom('smooth')}
        />
      </div>
    </div>
  )
})
