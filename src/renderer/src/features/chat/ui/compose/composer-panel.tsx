import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ListTodo } from 'lucide-react'
import type { TanzoDataParts } from '@shared/agent-message'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GoalPanelRow } from './goal-panel-row'
import { TodoPanelContent } from './todo-panel-content'
import { TODO_PANEL_CONTENT_MAX_HEIGHT_REM, type TodoPanelTask } from './todo-panel-utils'
import { composeSurfaceClass } from './surface-style'

export interface ComposerPanelProps {
  goal?: TanzoDataParts['goal']['goal']
  todos: TodoPanelTask[]
  onGoalCommand?: (args: string) => Promise<string>
}

export function ComposerPanel({
  goal,
  todos,
  onGoalCommand
}: ComposerPanelProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [isTodoPanelOpen, setIsTodoPanelOpen] = useState(false)
  const hasTodos = todos.length > 0
  const completedTodoCount = todos.filter((todo) => todo.status === 'completed').length

  if (!goal && !hasTodos) return null

  return (
    <div
      className={cn(
        composeSurfaceClass,
        'mx-auto w-full min-w-0 gap-0 overflow-hidden rounded-[var(--radius-xl)] rounded-b-none border-b-0 @md/chat:w-[90%]',
        'bg-[color-mix(in_oklab,var(--card)_95%,transparent)] backdrop-blur-2xl backdrop-saturate-150'
      )}
    >
      {hasTodos ? (
        <>
          <div
            className={cn(
              'flex h-7 w-full items-center justify-between px-3 text-secondary-foreground/70 transition-colors duration-150 hover:text-secondary-foreground'
            )}
          >
            <Button
              type="button"
              onClick={() => setIsTodoPanelOpen((open) => !open)}
              aria-expanded={isTodoPanelOpen}
              variant="ghost"
              size="xs"
              className="h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0 text-inherit hover:bg-transparent hover:text-inherit dark:hover:bg-transparent aria-expanded:bg-transparent focus-visible:bg-transparent"
            >
              <ListTodo className="size-3.5 shrink-0" />
              <span className="text-xs font-medium">{t('chat.composer.todoPanel.label')}</span>
              <ChevronDown
                className={cn(
                  'size-3 shrink-0 text-muted-foreground/55 transition-transform duration-200',
                  isTodoPanelOpen ? 'rotate-0' : '-rotate-90'
                )}
                strokeWidth={2}
              />
            </Button>
            <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground/60">
              {completedTodoCount}/{todos.length}
            </span>
          </div>
          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
              isTodoPanelOpen
                ? 'grid-rows-[1fr] opacity-100'
                : 'pointer-events-none grid-rows-[0fr] opacity-0'
            )}
          >
            <div className="overflow-hidden">
              <div className="border-t border-border/30">
                <TodoPanelContent
                  todos={todos}
                  maxHeight={`${TODO_PANEL_CONTENT_MAX_HEIGHT_REM}rem`}
                />
              </div>
            </div>
          </div>
        </>
      ) : null}
      {goal ? (
        <GoalPanelRow
          goal={goal}
          className={cn(hasTodos && 'border-t border-border/40')}
          onEdit={(objective) => void onGoalCommand?.(objective)}
          onPause={() => void onGoalCommand?.('pause')}
          onResume={() => void onGoalCommand?.('resume')}
          onClear={() => void onGoalCommand?.('clear')}
        />
      ) : null}
    </div>
  )
}
