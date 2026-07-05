import { useState } from 'react'
import {
  Ban,
  CircleAlert,
  CircleCheckBig,
  CircleDashed,
  GitBranch,
  ListTree,
  Pause,
  PowerOff
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SubagentTask, SubagentTaskResult } from '@shared/subagent-task'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useChatSession, useSidecarState } from '../model/conversation/use-chat-session'

const ACTIVE_STATUSES = new Set<SubagentTask['status']>(['pending', 'running', 'blocked'])

const STATUS_ICON_TONE: Record<SubagentTask['status'], string> = {
  pending: 'text-muted-foreground/70',
  running: 'text-primary',
  blocked: 'text-amber-500',
  done: 'text-emerald-500/85',
  failed: 'text-red-500',
  cancelled: 'text-muted-foreground/70'
}

/** App-restart interruptions get a softer visual treatment than genuine failures. */
const INTERRUPTED_ICON_TONE = 'text-muted-foreground/55'

function statusIcon(
  status: SubagentTask['status'],
  failureKind?: SubagentTaskResult['failureKind']
): { Icon: React.ElementType; spin?: boolean; overrideTone?: string } {
  switch (status) {
    case 'done':
      return { Icon: CircleCheckBig }
    case 'failed':
      // App-restart interruptions: use PowerOff icon with muted tone instead of red CircleAlert.
      if (failureKind === 'app-restart')
        return { Icon: PowerOff, overrideTone: INTERRUPTED_ICON_TONE }
      return { Icon: CircleAlert }
    case 'cancelled':
      return { Icon: Ban }
    case 'blocked':
      return { Icon: Pause }
    case 'running':
      return { Icon: CircleDashed, spin: true }
    default:
      return { Icon: CircleDashed }
  }
}

export function TaskOverviewPill({ chatId }: { chatId: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const session = useChatSession(chatId)
  const { tasks } = useSidecarState(session)
  const [open, setOpen] = useState(false)

  if (tasks.length === 0) return null

  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status))
  const settled = tasks.filter((task) => !ACTIVE_STATUSES.has(task.status))
  const hasBlocked = active.some((task) => task.status === 'blocked')
  const activeCount = active.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('chat.taskPanel.title')}
            className={cn(
              'app-no-drag h-7 max-w-[16rem] gap-1.5 rounded-md border-0 bg-transparent px-2 text-[0.6875rem] font-medium shadow-none',
              'text-muted-foreground transition-colors duration-150',
              'hover:bg-transparent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              hasBlocked && 'text-amber-600 hover:text-amber-600 dark:text-amber-400'
            )}
          >
            <ListTree className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{t('chat.taskPanel.title')}</span>
            {activeCount > 0 ? (
              <span className="rounded-full bg-foreground/[0.075] px-1.5 py-px text-[0.5625rem] tabular-nums text-foreground/62">
                {activeCount}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-[320px] gap-0 overflow-hidden rounded-[min(var(--radius-lg),14px)] border border-border/35 bg-background/96 p-0 shadow-xl backdrop-blur-md"
      >
        <header className="flex items-center gap-1.5 border-b border-border/25 px-2.5 py-1.5">
          <ListTree className="size-3 shrink-0 text-muted-foreground/65" strokeWidth={2} />
          <span className="text-[0.6875rem] font-semibold tracking-tight">
            {t('chat.taskPanel.title')}
          </span>
          <span className="text-[0.5625rem] tabular-nums text-muted-foreground/50">
            {tasks.length}
          </span>
        </header>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          <TaskGroup label={t('chat.taskPanel.running')} tasks={active} />
          <TaskGroup label={t('chat.taskPanel.done')} tasks={settled} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TaskGroup({
  label,
  tasks
}: {
  label: string
  tasks: SubagentTask[]
}): React.JSX.Element | null {
  if (tasks.length === 0) return null
  return (
    <section className="mb-1 last:mb-0">
      <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5">
        <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">
          {label}
        </span>
        <span className="text-[0.5625rem] tabular-nums text-muted-foreground/40">
          {tasks.length}
        </span>
      </div>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </section>
  )
}

function TaskRow({ task }: { task: SubagentTask }): React.JSX.Element {
  const { t } = useTranslation()
  const { Icon, spin, overrideTone } = statusIcon(task.status, task.result?.failureKind)
  const detail = blockDetail(task, t)
  const isInterrupted = task.result?.failureKind === 'app-restart'
  const settled = task.status === 'done' || task.status === 'cancelled'
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 transition-colors',
        'hover:bg-foreground/[0.045]'
      )}
      title={isInterrupted ? t('chat.taskPanel.interrupted') : undefined}
    >
      <Icon
        className={cn(
          'size-3 shrink-0',
          overrideTone ?? STATUS_ICON_TONE[task.status],
          spin && 'animate-spin'
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          'shrink-0 font-mono text-[0.5625rem] tabular-nums',
          settled ? 'text-muted-foreground/45' : 'text-primary/80'
        )}
      >
        {task.id}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[0.6875rem] leading-tight',
          settled ? 'text-foreground/50' : 'text-foreground/80'
        )}
        title={task.objective}
      >
        {task.objective}
      </span>
      {detail ? (
        <span
          className="flex shrink-0 items-center gap-0.5 text-[0.5625rem] text-amber-600/90 dark:text-amber-400/90"
          title={detail.text}
        >
          <detail.Icon className="size-2.5 shrink-0" aria-hidden="true" />
        </span>
      ) : task.phase ? (
        <span className="max-w-[6rem] shrink-0 truncate text-[0.5625rem] text-muted-foreground/45">
          {task.phase}
        </span>
      ) : null}
    </div>
  )
}

function blockDetail(
  task: SubagentTask,
  t: ReturnType<typeof useTranslation>['t']
): { Icon: React.ElementType; text: string } | null {
  if (task.block?.kind === 'dependency') {
    return {
      Icon: GitBranch,
      text: t('chat.taskPanel.blockedDependency', { tasks: task.block.taskIds.join(', ') })
    }
  }
  if (task.block?.kind === 'approval') {
    return { Icon: Pause, text: t('chat.taskPanel.blockedApproval') }
  }
  return null
}
