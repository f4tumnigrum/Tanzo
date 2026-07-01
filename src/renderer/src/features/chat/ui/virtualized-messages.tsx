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
    const [isAtBottom, setIsAtBottom] = useState(true)

    const scrollToBottom = useCallback(
      (behavior: 'auto' | 'smooth' = 'smooth') => {
        if (messages.length === 0) return
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
          behavior
        })
      },
      [messages.length]
    )

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom])

    useEffect(() => {
      if (messages.length === 0 || initialScrolledThreadRef.current === threadId) return
      initialScrolledThreadRef.current = threadId

      const frame = requestAnimationFrame(() => scrollToBottom('auto'))
      return () => cancelAnimationFrame(frame)
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
          data={messages as TanzoUIMessage[]}
          context={{ offset: composerOffset, footer: streamFooter }}
          alignToBottom
          initialTopMostItemIndex={
            messages.length > 0 ? { index: messages.length - 1, align: 'end' } : undefined
          }
          followOutput={(atBottom) => (atBottom ? 'auto' : false)}
          atBottomStateChange={setIsAtBottom}
          atBottomThreshold={32}
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
            visible={!isAtBottom && messages.length > 0}
            onClick={() => scrollToBottom('smooth')}
          />
        </div>
      </div>
    )
  })
)
