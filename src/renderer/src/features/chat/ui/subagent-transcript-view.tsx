import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SubagentTask } from '@shared/subagent-task'
import { Button } from '@/components/ui/button'
import { MessageList } from './message-list'
import {
  useChatSession,
  useMessageOrder,
  useRunState
} from '../model/conversation/use-chat-session'

/**
 * Full-screen, read-only view of a sub-agent's executor conversation. Rendered
 * in place of the main ActiveChat (same footprint), with a back button that
 * returns to the main conversation.
 *
 * Read-only is enforced structurally (no composer, no fork/edit props) and in
 * the main process (ipc/chat.ts rejects message writes into a sub-agent chat).
 */
export function SubagentTranscriptView({
  task,
  onBack
}: {
  task: SubagentTask
  onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const session = useChatSession(task.chatId)
  const runState = useRunState(session)
  const order = useMessageOrder(session)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/25 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 gap-1.5 px-2 text-[0.75rem] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          {t('chat.taskPanel.backToChat')}
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-mono text-[0.6875rem] text-primary/80">{task.id}</span>
          <span className="truncate text-[0.75rem] text-foreground/80" title={task.objective}>
            {task.objective}
          </span>
        </div>
        <span className="shrink-0 text-[0.625rem] uppercase tracking-wide text-muted-foreground/55">
          {t('chat.taskPanel.readOnly')}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {order.length > 0 ? (
          <div className="absolute inset-0">
            <MessageList
              session={session}
              threadId={task.chatId}
              isStreaming={runState.isStreaming}
              composerOffset={24}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[0.75rem] text-muted-foreground/60">
            {t('chat.taskPanel.emptyTranscript')}
          </div>
        )}
      </div>
    </div>
  )
}
