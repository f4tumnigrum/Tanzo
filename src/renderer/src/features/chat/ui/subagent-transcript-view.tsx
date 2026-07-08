import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Milestone, StickyNote } from 'lucide-react'
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

      <TaskActivityTimeline task={task} />

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

type ActivityEntry = { kind: 'phase' | 'note'; text: string; at: number }

function TaskActivityTimeline({ task }: { task: SubagentTask }): React.JSX.Element | null {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const entries: ActivityEntry[] = [
    ...task.phases.map((p): ActivityEntry => ({ kind: 'phase', text: p.name, at: p.at })),
    ...task.notes.map((n): ActivityEntry => ({ kind: 'note', text: n.text, at: n.at }))
  ].sort((a, b) => a.at - b.at)

  if (entries.length === 0) return null

  const latest = entries[entries.length - 1]
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <section className="shrink-0 border-b border-border/20 px-5 py-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left"
        aria-expanded={expanded}
      >
        <Chevron className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        <span className="shrink-0 text-[0.5625rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
          {t('chat.taskPanel.activity')}
        </span>
        <span className="shrink-0 text-[0.5625rem] tabular-nums text-muted-foreground/40">
          {entries.length}
        </span>
        {!expanded ? (
          <span className="min-w-0 flex-1 truncate text-[0.625rem] text-muted-foreground/55">
            {latest.text}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <ol className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pl-1">
          {entries.map((entry, index) => (
            <li
              key={`${entry.at}-${index}`}
              className="flex min-w-0 items-start gap-1.5 text-[0.625rem] leading-[1.5]"
            >
              {entry.kind === 'phase' ? (
                <Milestone
                  className="mt-px size-3 shrink-0 text-muted-foreground/45"
                  aria-hidden="true"
                />
              ) : (
                <StickyNote className="mt-px size-3 shrink-0 text-primary/60" aria-hidden="true" />
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 break-words',
                  entry.kind === 'note' ? 'text-foreground/75' : 'text-muted-foreground/70'
                )}
              >
                {entry.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
