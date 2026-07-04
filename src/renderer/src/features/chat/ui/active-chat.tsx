import { useCallback, useMemo, useRef, useState } from 'react'
import { useChatSession } from '../model/conversation/use-chat-session'
import type { SubagentTaskApprovalResponse } from '@shared/subagent-task'
import {
  ChatActionsProvider,
  type ApprovalDecision,
  type QuestionDecision
} from '../chat-actions-context'
import { chatClient } from '@/platform/electron/chat-client'
import { Spinner } from '@/components/ui/spinner'
import { ChatEmpty } from './chat-empty'
import { Composer } from './compose/composer'
import { RunNotice } from './compose/run-notice'
import { StreamingIndicator } from './message/streaming-indicator'
import { CompactionMessage } from './message/compaction-message'
import { SubagentApprovalCard } from './tool/subagent-approval-card'
import { MessageList } from './message-list'

export function ActiveChat({
  chatId,
  onForkMessage
}: {
  chatId: string
  onForkMessage: (messageId: string) => void
}): React.JSX.Element {
  const { session, state } = useChatSession(chatId)

  const streamingMessageId =
    state.isStreaming && state.activeRunKind !== 'compaction'
      ? (state.messages.at(-1)?.id ?? null)
      : null

  const lastMessage = state.messages.at(-1)
  const editableMessageId =
    !state.isStreaming && lastMessage?.role === 'user' ? lastMessage.id : null

  const observerRef = useRef<ResizeObserver | null>(null)
  const [composerOffset, setComposerOffset] = useState(168)

  const measureComposer = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const update = (): void => setComposerOffset(node.offsetHeight + 16)
    const observer = new ResizeObserver(update)
    observer.observe(node)
    observerRef.current = observer
    update()
  }, [])

  const actions = useMemo(
    () => ({
      chatId,
      async respondToApprovals(decisions: ApprovalDecision[]): Promise<void> {
        session.clearRunNotice()
        await session.respondApprovals(
          decisions.map((decision) => ({
            approvalId: decision.approvalId,
            approved: decision.approved,
            ...(decision.reason ? { reason: decision.reason } : {}),
            ...(decision.saveAs ? { scope: decision.saveAs.scope } : {})
          }))
        )
      },
      async respondToTaskApproval(decision: SubagentTaskApprovalResponse): Promise<void> {
        await session.respondTaskApproval(decision)
      },
      async respondToQuestion(decision: QuestionDecision): Promise<void> {
        const { questionId, ...reply } = decision
        await chatClient.answerQuestion(chatId, questionId, reply)
      }
    }),
    [chatId, session]
  )

  const composer = <Composer chatId={chatId} />

  if (state.isLoadingHistory && state.messages.length === 0 && !state.isStreaming) {
    return <ChatLoadingShell />
  }

  const streamFooter =
    state.compactionInProgress || state.runNotice ? (
      <>
        {state.compactionInProgress ? <CompactionMessage {...state.compactionInProgress} /> : null}
        {state.runNotice ? (
          <RunNotice
            notice={state.runNotice}
            onRetry={state.isStreaming ? undefined : () => session.retryLastTurn()}
            onDismiss={() => session.clearRunNotice()}
          />
        ) : null}
      </>
    ) : null

  return (
    <ChatActionsProvider value={actions}>
      {state.messages.length > 0 ? (
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <MessageList
              messages={state.messages}
              activeStreamingMessageId={streamingMessageId}
              isStreaming={state.isStreaming}
              threadId={chatId}
              composerOffset={composerOffset}
              streamFooter={streamFooter}
              onForkMessage={onForkMessage}
              editableMessageId={editableMessageId}
              onEditMessage={(messageId, text) => session.editMessage(messageId, text)}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
            <div
              ref={measureComposer}
              className="pointer-events-auto mx-auto w-full max-w-3xl px-3 pb-4 @md/chat:px-5"
            >
              {state.subagentApprovals.map((approval) => (
                <SubagentApprovalCard
                  key={approval.approval.approvalId}
                  approval={approval}
                  onRespond={actions.respondToTaskApproval}
                />
              ))}
              {state.transientStatus ? (
                <StreamingIndicator label={state.transientStatus} className="px-1 pb-1 pt-0" />
              ) : null}
              {composer}
            </div>
          </div>
        </div>
      ) : (
        <ChatEmpty>{composer}</ChatEmpty>
      )}
    </ChatActionsProvider>
  )
}

function ChatLoadingShell(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center">
      <Spinner className="size-5 text-foreground/35" />
    </div>
  )
}
