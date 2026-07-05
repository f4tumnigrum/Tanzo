import { ArrowLeft, ListTree } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SubagentTask } from '@shared/subagent-task'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MessageList } from './message-list'
import {
  useChatSession,
  useMessageOrder,
  useRunState
} from '../model/conversation/use-chat-session'

/** Status-dot tone mirrors the task panel so the header reads at a glance. */
const STATUS_DOT_TONE: Record<SubagentTask['status'], string> = {
  pending: 'bg-muted-foreground/40',
  running: 'bg-primary',
  blocked: 'bg-amber-500',
  done: 'bg-emerald-500/80',
  failed: 'bg-red-500',
  cancelled: 'bg-muted-foreground/40'
}

/** "explore" -> "Explore". Falls back gracefully for empty/odd values. */
function agentLabel(agentType: string): string {
  return agentType ? agentType.charAt(0).toUpperCase() + agentType.slice(1) : agentType
}

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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/25 px-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 gap-1 rounded-md px-1.5 text-[0.75rem] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          {t('chat.taskPanel.backToChat')}
        </Button>

        <div className="h-4 w-px shrink-0 bg-border/40" aria-hidden="true" />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT_TONE[task.status])}
            aria-hidden="true"
          />
          <span className="truncate text-[0.8125rem] font-medium text-foreground/90">
            {agentLabel(task.agentType)}
          </span>
          <span className="shrink-0 rounded bg-foreground/[0.06] px-1.5 py-px font-mono text-[0.625rem] tabular-nums text-muted-foreground/70">
            {task.id}
          </span>
        </div>

        <span className="shrink-0 rounded-full border border-border/40 px-2 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wide text-muted-foreground/60">
          {t('chat.taskPanel.readOnly')}
        </span>
      </header>

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
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <ListTree className="size-5 text-muted-foreground/30" aria-hidden="true" />
            <span className="text-[0.75rem] text-muted-foreground/55">
              {t('chat.taskPanel.emptyTranscript')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
