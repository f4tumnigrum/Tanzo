import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SubagentTask } from '@shared/subagent-task'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MessageList } from './message-list'
import { ToolMetaChip } from './tool/primitives/header'
import { TASK_STATUS_TONE } from './tool/renderers/shared'
import {
  useChatSession,
  useMessageOrder,
  useRunState
} from '../model/conversation/use-chat-session'

function agentLabel(agentType: string): string {
  return agentType ? agentType.charAt(0).toUpperCase() + agentType.slice(1) : agentType
}

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
      <header className="flex h-(--titlebar-height) shrink-0 items-center gap-2 border-b border-border/25 px-5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Button
            onClick={onBack}
            type="button"
            variant="toolbar"
            size="toolbar"
            className="-ml-1 gap-1 px-2 text-[0.6875rem]"
            aria-label={t('common.actions.goBack')}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span>{t('common.actions.back')}</span>
          </Button>

          <div className="ml-1 flex min-w-0 items-center gap-2">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', TASK_STATUS_TONE[task.status].dot)}
              aria-hidden="true"
            />
            <h1 className="min-w-0 truncate text-[0.875rem] font-semibold leading-tight tracking-tight">
              {agentLabel(task.agentType)}
            </h1>
            <ToolMetaChip text={task.id} className="text-[0.625rem]" />
          </div>
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
            <span className="text-[0.75rem] text-muted-foreground/55">
              {t('chat.taskPanel.emptyTranscript')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
