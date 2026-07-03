import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { Virtuoso, type Components, type VirtuosoHandle } from 'react-virtuoso'
import { cn } from '@/lib/utils'
import type { TanzoUIMessage } from '@shared/agent-message'
import { MessageItem } from './message/message-item'
import { ScrollToBottomButton } from './scroll-to-bottom-button'

export interface VirtualizedMessagesRef {
  scrollToBottom(behavior?: 'auto' | 'smooth'): void
}

export interface VirtualizedMessagesProps {
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

type ScrollerProps = HTMLAttributes<HTMLDivElement>

const Scroller = memo(
  forwardRef<HTMLDivElement, ScrollerProps>(function Scroller({ className, ...props }, ref) {
    return <div ref={ref} className={cn('scrollbar-subtle', className)} {...props} />
  })
)

interface FooterContext {
  offset: number
  footer?: ReactNode
}

const Footer = memo(function Footer({ context }: { context?: FooterContext }) {
  return (
    <>
      {context?.footer ? (
        <div className="mx-auto w-full max-w-3xl px-3 @md/chat:px-5">{context.footer}</div>
      ) : null}
      <div style={{ height: context?.offset ?? 24 }} />
    </>
  )
})

const components = { Scroller, Footer } satisfies Components<TanzoUIMessage, FooterContext>

const computeItemKey = (_index: number, message: TanzoUIMessage): string => message.id

/**
 * Distance (px) from the true bottom within which Virtuoso still reports
 * `atBottom`. Generous on purpose so that per-frame streaming growth cannot
 * flip the state off before the follow-up autoscroll lands.
 */
const BOTTOM_EPSILON = 48

/**
 * Sticky-bottom is delegated entirely to react-virtuoso's native machinery:
 *
 * - `followOutput="auto"` keeps the view glued when new items are appended
 *   and the user is at the bottom (the at-bottom guard is built in).
 * - `followOutput` only reacts to item-count changes. A streaming message
 *   grows in place, so `totalListHeightChanged` + `autoscrollToBottom()` — the
 *   documented pairing for exactly this case — cover in-place height growth
 *   (tokens, images, syntax-highlight reflow, footer changes).
 * - `autoscrollToBottom()` goes through Virtuoso's own scheduler, so it cannot
 *   race Virtuoso's measurement corrections. Fighting between those
 *   corrections and a hand-rolled ResizeObserver glue is what previously made
 *   the view bounce off the bottom.
 * - Scrolling away from the bottom flips Virtuoso's `atBottom` to false, which
 *   silences both follow mechanisms — no bespoke wheel/touch intent tracking.
 */
export const VirtualizedMessages = memo(
  forwardRef<VirtualizedMessagesRef, VirtualizedMessagesProps>(function VirtualizedMessages(
    {
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
    },
    ref
  ) {
    const virtuosoRef = useRef<VirtuosoHandle>(null)
    // Threads open at the bottom (initialTopMostItemIndex), so start true.
    const atBottomRef = useRef(true)
    const [atBottom, setAtBottom] = useState(true)

    const onAtBottomChange = useCallback((next: boolean) => {
      atBottomRef.current = next
      setAtBottom(next)
    }, [])

    // `scrollTo` (native handle method) targets the scroller's true bottom,
    // including the footer spacer — `scrollToIndex(LAST)` would stop above it.
    const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior })
    }, [])

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom])

    const onTotalListHeightChanged = useCallback(() => {
      if (atBottomRef.current) virtuosoRef.current?.autoscrollToBottom()
    }, [])

    const renderItem = useCallback(
      (_index: number, message: TanzoUIMessage) => (
        <div className="mx-auto w-full max-w-3xl px-3 @md/chat:px-5">
          <MessageItem
            message={message}
            isStreaming={isStreaming && message.id === activeStreamingMessageId}
            {...(onForkMessage ? { onFork: () => onForkMessage(message.id) } : {})}
            {...(onEditMessage && message.id === editableMessageId
              ? { onEdit: (text: string) => onEditMessage(message.id, text) }
              : {})}
          />
        </div>
      ),
      [isStreaming, activeStreamingMessageId, onForkMessage, onEditMessage, editableMessageId]
    )

    return (
      <div className={cn('relative h-full min-h-0 w-full', className)}>
        <Virtuoso<TanzoUIMessage, FooterContext>
          key={threadId}
          ref={virtuosoRef}
          data={messages as TanzoUIMessage[]}
          context={{ offset: composerOffset, footer: streamFooter }}
          alignToBottom
          initialTopMostItemIndex={
            messages.length > 0 ? { index: messages.length - 1, align: 'end' } : undefined
          }
          followOutput="auto"
          atBottomStateChange={onAtBottomChange}
          atBottomThreshold={BOTTOM_EPSILON}
          totalListHeightChanged={onTotalListHeightChanged}
          components={components}
          computeItemKey={computeItemKey}
          itemContent={renderItem}
          increaseViewportBy={{ top: 240, bottom: 120 }}
        />
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
)
