import { useCallback, useMemo, useRef, useState } from 'react'
import {
  useChatSession,
  useMessageOrder,
  useRunState,
  useSidecarState,
  useTranscriptSelector
} from '../model/conversation/use-chat-session'
import type { SubagentTaskApprovalResponse } from '@shared/subagent-task'
import {
  ChatActionsProvider,
  type ApprovalDecision,
  type QuestionDecision
} from '../chat-actions-context'
import { chatClient } from '@/platform/electron/chat-client'
import { trailingUserMessageId } from '../model/conversation/message-utils'
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
  const session = useChatSession(chatId)
  const runState = useRunState(session)
  const sidecar = useSidecarState(session)
  const order = useMessageOrder(session)

  const streamingMessageId =
    runState.isStreaming && runState.activeRunKind !== 'compaction' ? (order.at(-1) ?? null) : null

  // Derived subscription (id + role only) so streaming text deltas never
  // re-render this component tree.
  const editableUserId = useTranscriptSelector(session, trailingUserMessageId, Object.is)
  const editableMessageId = !runState.isStreaming ? editableUserId : null

  const handleEditMessage = useCallback(
    (messageId: string, text: string) => session.editMessage(messageId, text),
    [session]
  )

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

  const streamFooter =
    runState.compactionInProgress || runState.runNotice ? (
      <>
        {runState.compactionInProgress ? (
          <CompactionMessage {...runState.compactionInProgress} />
        ) : null}
        {runState.runNotice ? (
          <RunNotice
            notice={runState.runNotice}
            onRetry={runState.isStreaming ? undefined : () => session.retryLastTurn()}
            onDismiss={() => session.clearRunNotice()}
          />
        ) : null}
      </>
    ) : null

  return (
    <ChatActionsProvider value={actions}>
      {order.length > 0 ? (
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <MessageList
              session={session}
              activeStreamingMessageId={streamingMessageId}
              isStreaming={runState.isStreaming}
              threadId={chatId}
              composerOffset={composerOffset}
              streamFooter={streamFooter}
              onForkMessage={onForkMessage}
              editableMessageId={editableMessageId}
              onEditMessage={handleEditMessage}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
            <div
              ref={measureComposer}
              className="pointer-events-auto mx-auto w-full max-w-3xl px-3 pb-4 @md/chat:px-5"
            >
              {sidecar.subagentApprovals.map((approval) => (
                <SubagentApprovalCard
                  key={approval.approval.approvalId}
                  approval={approval}
                  onRespond={actions.respondToTaskApproval}
                />
              ))}
              {runState.transientStatus ? (
                <StreamingIndicator label={runState.transientStatus} className="px-1 pb-1 pt-0" />
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
