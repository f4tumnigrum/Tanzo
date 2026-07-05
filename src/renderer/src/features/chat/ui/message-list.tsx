import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { cn } from '@/lib/utils'
import type { ChatSession } from '../model/conversation/session-manager'
import { useMessage, useMessageOrder } from '../model/conversation/use-chat-session'
import { MessageItem } from './message/message-item'
import { ScrollToBottomButton } from './scroll-to-bottom-button'

export interface MessageListProps {
  session: ChatSession

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

/** Messages mounted on first paint (the visible tail of the thread). */
const INITIAL_MOUNT_COUNT = 30
/** Older messages mounted per idle/scroll batch. */
const MOUNT_BATCH_SIZE = 50
/** Scroll distance (px) from the top that triggers an eager batch mount. */
const TOP_MOUNT_THRESHOLD = 600

function requestIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: 500 })
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(callback, 50)
  return () => clearTimeout(handle)
}

/**
 * One row = one subscription. Streaming deltas notify only the row whose
 * message changed; every other row's `memo` sees identical props and skips.
 */
const MessageRow = memo(function MessageRow({
  session,
  messageId,
  isStreaming,
  onFork,
  editable,
  onEdit
}: {
  session: ChatSession
  messageId: string
  isStreaming: boolean
  onFork?: (messageId: string) => void | Promise<void>
  editable: boolean
  onEdit?: (messageId: string, text: string) => void
}): React.JSX.Element | null {
  const message = useMessage(session, messageId)
  if (!message) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-3 @md/chat:px-5 [content-visibility:auto] [contain-intrinsic-size:auto_150px]">
      <MessageItem
        message={message}
        isStreaming={isStreaming}
        {...(onFork ? { onFork: () => onFork(messageId) } : {})}
        {...(onEdit && editable ? { onEdit: (text: string) => onEdit(messageId, text) } : {})}
      />
    </div>
  )
})

/**
 * Plain scroller — no virtualization. Off-screen messages are skipped by the
 * compositor via `content-visibility: auto`, which is enough for
 * conversation-sized lists and removes the whole class of measurement /
 * scroll-correction bugs a virtualizer brings.
 *
 * Long threads mount progressively: the visible tail renders on the first
 * frame, older messages back-fill in idle batches (or eagerly when the user
 * scrolls near the top), so switch latency is decoupled from thread length.
 *
 * Sticky-bottom is a single writer: a ResizeObserver on the content box
 * re-pins `scrollTop` whenever content grows while the user is at the bottom.
 * Native scroll anchoring is disabled (`overflow-anchor: none`) so the
 * browser never competes with that writer.
 */
export const MessageList = memo(function MessageList({
  session,
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
  const order = useMessageOrder(session)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  // Threads open pinned to the bottom, so start true.
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  // Progressive mounting state: number of messages hidden at the TOP of the
  // thread. New messages append at the bottom and never change this.
  const [hiddenCount, setHiddenCount] = useState(() =>
    Math.max(0, order.length - INITIAL_MOUNT_COUNT)
  )
  // Anchor compensation for batches mounted above the viewport.
  const anchorRef = useRef<number | null>(null)

  const mountOlderBatch = useCallback(() => {
    setHiddenCount((current) => {
      if (current === 0) return current
      const scroller = scrollerRef.current
      if (scroller && !atBottomRef.current) anchorRef.current = scroller.scrollHeight
      return Math.max(0, current - MOUNT_BATCH_SIZE)
    })
  }, [])

  const syncAtBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const next =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_EPSILON
    atBottomRef.current = next
    setAtBottom(next)
    if (scroller.scrollTop < TOP_MOUNT_THRESHOLD) mountOlderBatch()
  }, [mountOlderBatch])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior })
  }, [])

  // Open at the bottom whenever the thread changes; reset progressive mount.
  useLayoutEffect(() => {
    atBottomRef.current = true
    setAtBottom(true)
    setHiddenCount(Math.max(0, session.transcript.getOrder().length - INITIAL_MOUNT_COUNT))
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [threadId, session])

  // Back-fill older messages during idle time until the whole thread is
  // mounted, keeping the scroll position visually anchored.
  useEffect(() => {
    if (hiddenCount === 0) return
    return requestIdle(mountOlderBatch)
  }, [hiddenCount, mountOlderBatch])

  // Apply anchor compensation synchronously after a batch mounts above.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    anchorRef.current = null
    const scroller = scrollerRef.current
    if (anchor === null || !scroller || atBottomRef.current) return
    scroller.scrollTop += scroller.scrollHeight - anchor
  }, [hiddenCount])

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

  const visibleIds = hiddenCount > 0 ? order.slice(hiddenCount) : order

  return (
    <div className={cn('relative h-full min-h-0 w-full', className)}>
      <div
        ref={scrollerRef}
        onScroll={syncAtBottom}
        className="scrollbar-subtle h-full overflow-y-auto [overflow-anchor:none]"
      >
        <div ref={contentRef} className="flex min-h-full flex-col justify-end">
          {visibleIds.map((messageId) => (
            <MessageRow
              key={messageId}
              session={session}
              messageId={messageId}
              isStreaming={isStreaming && messageId === activeStreamingMessageId}
              {...(onForkMessage ? { onFork: onForkMessage } : {})}
              editable={messageId === editableMessageId}
              {...(onEditMessage ? { onEdit: onEditMessage } : {})}
            />
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
          visible={!atBottom && order.length > 0}
          onClick={() => scrollToBottom('smooth')}
        />
      </div>
    </div>
  )
})
