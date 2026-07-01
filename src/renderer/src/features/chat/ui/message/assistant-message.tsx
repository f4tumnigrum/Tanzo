import { memo, useMemo } from 'react'
import {
  isFileUIPart,
  isDataUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  isDynamicToolUIPart,
  getToolName,
  type SourceDocumentUIPart,
  type SourceUrlUIPart
} from 'ai'
import { cn } from '@/lib/utils'
import type { TanzoUIMessage } from '@shared/agent-message'
import { Message, MessageContent } from './message'
import { MessageCopyButton } from './message-copy-button'
import { MessageForkButton } from './message-fork-button'
import { Response } from './response'
import { StreamingIndicator } from './streaming-indicator'
import { ToolMessageBlock } from './tool-message-block'
import { ApprovalGroup } from '../tool/approval-group'
import { PlanReviewCard } from '../tool/plan-review-card'
import { buildToolRenderContext } from '../tool/render-context'
import { XmlTag } from './xml-tag'
import { DataPartBlock, type DataPartLike } from './data-part-block'
import { FinishFooter } from './finish-footer'
import { isSafeExternalHref } from './href-safety'

function isPlanReviewPart(part: TanzoUIMessage['parts'][number]): boolean {
  return (
    (isToolUIPart(part) || isDynamicToolUIPart(part)) &&
    getToolName(part as never) === 'exitPlanMode'
  )
}

export interface AssistantMessageProps {
  message: TanzoUIMessage
  isStreaming?: boolean

  onFork?: () => void | Promise<void>
  className?: string
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  isStreaming = false,
  onFork,
  className
}: AssistantMessageProps): React.JSX.Element {
  const parts = message.parts

  const hasUsage =
    (message.metadata?.steps?.some((step) => step.usage) ?? false) ||
    Boolean(message.metadata?.usage)

  const copyText = useMemo(() => {
    return parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join('\n\n')
  }, [parts])

  const approvalContexts = useMemo(
    () =>
      parts
        .filter(
          (part) =>
            (isToolUIPart(part) || isDynamicToolUIPart(part)) &&
            !isPlanReviewPart(part) &&
            (part.state === 'approval-requested' || part.state === 'approval-responded')
        )
        .map((part) => buildToolRenderContext({ part: part as never }))
        .filter((ctx): ctx is NonNullable<typeof ctx> => ctx !== null),
    [parts]
  )

  return (
    <Message from="assistant" className={className}>
      <MessageContent variant="flat" className="min-w-0 flex-1">
        <div className="space-y-2">
          {parts.map((part, index) => {
            if (isTextUIPart(part)) {
              const partIsStreaming = isStreaming && part.state === 'streaming'
              return (
                <Response key={`text-${index}`} content={part.text} isStreaming={partIsStreaming} />
              )
            }

            if (isReasoningUIPart(part)) {
              return (
                <XmlTag
                  key={`reasoning-${index}`}
                  tag="reasoning"
                  disclosureKey={`reasoning:${message.id}:${index}`}
                >
                  {part.text}
                </XmlTag>
              )
            }

            if (isToolUIPart(part) || isDynamicToolUIPart(part)) {
              if (isPlanReviewPart(part)) {
                return <PlanReviewCard key={`plan-${index}`} part={part as never} />
              }
              return <ToolMessageBlock key={`tool-${index}`} part={part as never} />
            }

            if (isDataUIPart(part)) {
              return <DataPartBlock key={`data-${index}`} part={part as DataPartLike} />
            }

            if (part.type === 'source-url') {
              const sourcePart = part as SourceUrlUIPart
              const content = sourcePart.title ?? sourcePart.url
              const className =
                'block truncate rounded-md border border-border/30 bg-card/30 px-2.5 py-1.5 text-[0.6875rem] text-foreground/85 underline-offset-2 hover:underline'
              if (!isSafeExternalHref(sourcePart.url)) {
                return (
                  <span key={`src-url-${index}`} className={className} title={sourcePart.url}>
                    {content}
                  </span>
                )
              }
              return (
                <a
                  key={`src-url-${index}`}
                  href={sourcePart.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                  title={sourcePart.url}
                >
                  {content}
                </a>
              )
            }

            if (part.type === 'source-document') {
              const sourcePart = part as SourceDocumentUIPart
              return (
                <div
                  key={`src-doc-${index}`}
                  className="flex items-center gap-2 rounded-md border border-border/30 bg-card/30 px-2.5 py-1.5 text-[0.6875rem]"
                >
                  <span className="font-mono text-foreground/80">{sourcePart.mediaType}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="truncate text-foreground/85">{sourcePart.title}</span>
                </div>
              )
            }

            if (isFileUIPart(part)) {
              return (
                <div
                  key={`file-${index}`}
                  className="flex items-center gap-2 rounded-md border border-border/30 bg-card/30 px-2.5 py-1.5 text-[0.6875rem]"
                >
                  <span className="font-mono text-foreground/80">{part.mediaType}</span>
                  {part.filename && <span className="text-muted-foreground">·</span>}
                  {part.filename && (
                    <span className="truncate text-foreground/85">{part.filename}</span>
                  )}
                </div>
              )
            }

            return null
          })}

          {approvalContexts.length > 0 ? <ApprovalGroup contexts={approvalContexts} /> : null}

          {isStreaming ? <StreamingIndicator /> : null}
        </div>
        {!isStreaming || hasUsage ? (
          <div
            className={cn(
              'mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1',
              'opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100'
            )}
          >
            {!isStreaming ? (
              <>
                <MessageForkButton {...(onFork ? { onFork } : {})} />
                <MessageCopyButton text={copyText} />
              </>
            ) : null}
            <FinishFooter message={message} />
          </div>
        ) : null}
      </MessageContent>
    </Message>
  )
})
