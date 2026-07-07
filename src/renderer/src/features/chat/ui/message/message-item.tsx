import { memo } from 'react'
import type { TanzoUIMessage } from '@shared/agent-message'
import { AssistantMessage } from './assistant-message'
import { CompactionMessage } from './compaction-message'
import { UserMessage } from './user-message'

export interface MessageItemProps {
  message: TanzoUIMessage

  isStreaming?: boolean

  onFork?: () => void | Promise<void>

  onEdit?: (text: string) => void
}

export const MessageItem = memo(function MessageItem({
  message,
  isStreaming = false,
  onFork,
  onEdit
}: MessageItemProps): React.JSX.Element | null {
  const compactionPart = message.parts.find((part) => part.type === 'data-compaction')
  if (compactionPart?.type === 'data-compaction')
    return <CompactionMessage {...compactionPart.data} />

  if (message.parts.some((part) => part.type === 'data-contextInjection')) return null
  if (message.role === 'user')
    return <UserMessage message={message} {...(onEdit ? { onEdit } : {})} />
  if (message.role === 'assistant') {
    return (
      <AssistantMessage
        message={message}
        isStreaming={isStreaming}
        {...(onFork ? { onFork } : {})}
      />
    )
  }
  return null
})
