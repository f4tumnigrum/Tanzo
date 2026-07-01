import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
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
 * Distance (px) from the true bottom within which we still treat the view as
 * "pinned". Generous on purpose: it only decides the button visibility and the
 * point at which upward intent re-pins — it is NOT what keeps us glued while
 * content grows (that is driven by explicit intent below).
 */
const BOTTOM_EPSILON = 48

interface StickToBottom {
  onScrollerRef: (el: HTMLElement | null | Window) => void
  onAtBottomChange: (atBottom: boolean) => void
  shouldFollow: () => boolean
  isPinned: boolean
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void
}

/**
 * Intent-based sticky-bottom.
 *
 * The only source of truth for "keep following the stream" is `pinnedRef`. It
 * flips to `false` ONLY when the user actively scrolls up, and back to `true`
 * ONLY when the user returns to the bottom. Content height changes never touch
 * it — so streaming growth, image/font loads, code-highlight reflow, or a
 * changing footer can no longer bounce the view off the bottom.
 *
 * While pinned, a ResizeObserver on the scroll content forces
 * `scrollTop = scrollHeight` on every height change, which also covers the
 * footer/composer spacer and eliminates the "can't reach the bottom" gap.
 */
function useStickToBottom(): StickToBottom {
  const scrollerRef = useRef<HTMLElement | null>(null)
  const contentObserverRef = useRef<ResizeObserver | null>(null)
  // True = follow the bottom. Starts pinned; user intent is the only thing that unpins.
  const pinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)

  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return
    pinnedRef.current = next
    setIsPinned(next)
  }, [])

  const distanceFromBottom = useCallback((el: HTMLElement): number => {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }, [])

  const jumpToBottom = useCallback((behavior: 'auto' | 'smooth') => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const scrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      setPinned(true)
      jumpToBottom(behavior)
    },
    [jumpToBottom, setPinned]
  )

  // User-intent handlers: only an active upward gesture unpins.
  const handleUserIntent = useCallback(
    (deltaY: number) => {
      const el = scrollerRef.current
      if (!el) return
      if (deltaY < 0) {
        // Scrolling up — release the pin so the stream stops dragging the view down.
        if (distanceFromBottom(el) > BOTTOM_EPSILON) setPinned(false)
      }
    },
    [distanceFromBottom, setPinned]
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => handleUserIntent(event.deltaY),
    [handleUserIntent]
  )

  const touchYRef = useRef<number | null>(null)
  const handleTouchStart = useCallback((event: TouchEvent) => {
    touchYRef.current = event.touches[0]?.clientY ?? null
  }, [])
  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      const prev = touchYRef.current
      const next = event.touches[0]?.clientY ?? null
      if (prev == null || next == null) return
      // Finger moving down drags content down = scrolling up in content terms.
      handleUserIntent(prev - next < 0 ? -1 : 1)
      touchYRef.current = next
    },
    [handleUserIntent]
  )

  const onScrollerRef = useCallback(
    (el: HTMLElement | null | Window) => {
      // Detach previous listeners/observer.
      const prev = scrollerRef.current
      if (prev) {
        prev.removeEventListener('wheel', handleWheel)
        prev.removeEventListener('touchstart', handleTouchStart)
        prev.removeEventListener('touchmove', handleTouchMove)
      }
      contentObserverRef.current?.disconnect()
      contentObserverRef.current = null

      const node = el instanceof HTMLElement ? el : null
      scrollerRef.current = node
      if (!node) return

      node.addEventListener('wheel', handleWheel, { passive: true })
      node.addEventListener('touchstart', handleTouchStart, { passive: true })
      node.addEventListener('touchmove', handleTouchMove, { passive: true })

      // Keep the view glued to the bottom whenever content height changes while pinned.
      const observer = new ResizeObserver(() => {
        if (!pinnedRef.current) return
        jumpToBottom('auto')
      })
      // The scroller's first child is Virtuoso's sizing element; observe it for height growth.
      const content = node.firstElementChild
      if (content) observer.observe(content)
      observer.observe(node)
      contentObserverRef.current = observer
    },
    [handleWheel, handleTouchStart, handleTouchMove, jumpToBottom]
  )

  useEffect(() => {
    return () => {
      const prev = scrollerRef.current
      if (prev) {
        prev.removeEventListener('wheel', handleWheel)
        prev.removeEventListener('touchstart', handleTouchStart)
        prev.removeEventListener('touchmove', handleTouchMove)
      }
      contentObserverRef.current?.disconnect()
    }
  }, [handleWheel, handleTouchStart, handleTouchMove])

  // Virtuoso's own bottom detection re-pins us once the user lands back at the
  // bottom. It can only re-pin (never unpin) — unpinning is driven solely by the
  // upward-intent handlers above.
  const onAtBottomChange = useCallback(
    (atBottom: boolean) => {
      if (atBottom) setPinned(true)
    },
    [setPinned]
  )

  const shouldFollow = useCallback(() => pinnedRef.current, [])

  return { onScrollerRef, onAtBottomChange, shouldFollow, isPinned, scrollToBottom }
}

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
    const initialScrolledThreadRef = useRef<string | null>(null)
    const { onScrollerRef, onAtBottomChange, shouldFollow, isPinned, scrollToBottom } =
      useStickToBottom()

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom])

    // Initial landing on the newest message when a thread opens. Re-assert across a
    // couple of frames so late height growth (fonts/images/highlighting) can't strand it.
    useEffect(() => {
      if (messages.length === 0 || initialScrolledThreadRef.current === threadId) return
      initialScrolledThreadRef.current = threadId

      let raf1 = 0
      let raf2 = 0
      raf1 = requestAnimationFrame(() => {
        scrollToBottom('auto')
        raf2 = requestAnimationFrame(() => scrollToBottom('auto'))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }, [messages.length, scrollToBottom, threadId])

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
          scrollerRef={onScrollerRef}
          data={messages as TanzoUIMessage[]}
          context={{ offset: composerOffset, footer: streamFooter }}
          alignToBottom
          initialTopMostItemIndex={
            messages.length > 0 ? { index: messages.length - 1, align: 'end' } : undefined
          }
          followOutput={() => (shouldFollow() ? 'auto' : false)}
          atBottomStateChange={onAtBottomChange}
          atBottomThreshold={BOTTOM_EPSILON}
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
            visible={!isPinned && messages.length > 0}
            onClick={() => scrollToBottom('smooth')}
          />
        </div>
      </div>
    )
  })
)
