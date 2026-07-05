import { useTranslation } from 'react-i18next'
import type { SubagentTask } from '@shared/subagent-task'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { MessageList } from './message-list'
import {
  useChatSession,
  useMessageOrder,
  useRunState
} from '../model/conversation/use-chat-session'

/**
 * Read-only drill-down into a sub-agent's executor conversation. Reuses the
 * plain transcript renderer (MessageList) against the task's own chatId, which
 * auto-subscribes to that conversation's frame channel and loads its history.
 *
 * Read-only is enforced structurally, not by trust: no composer, no fork/edit
 * props are passed, and the main process rejects any message write into a
 * conversation whose parentRelation is 'subagent' (see ipc/chat.ts).
 */
export function SubagentTranscriptSheet({
  task,
  open,
  onOpenChange
}: {
  task: SubagentTask | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-2xl"
        aria-describedby={undefined}
      >
        {task ? <SheetBody task={task} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({ task }: { task: SubagentTask }): React.JSX.Element {
  const { t } = useTranslation()
  const session = useChatSession(task.chatId)
  const runState = useRunState(session)
  const order = useMessageOrder(session)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="gap-1 border-b border-border/25 px-4 py-3">
        <SheetTitle className="flex items-center gap-2 text-[0.8125rem]">
          <span className="font-mono text-[0.6875rem] text-primary/80">{task.id}</span>
          <span className="truncate font-normal text-foreground/80">{task.objective}</span>
        </SheetTitle>
        <SheetDescription className="text-[0.6875rem] text-muted-foreground/70">
          {t('chat.taskPanel.readOnlyView')}
        </SheetDescription>
      </SheetHeader>
      <div className="relative min-h-0 flex-1">
        {order.length > 0 ? (
          <div className="absolute inset-0">
            <MessageList
              session={session}
              threadId={task.chatId}
              isStreaming={runState.isStreaming}
              composerOffset={16}
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
