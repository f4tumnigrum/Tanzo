import { useTranslation } from 'react-i18next'
import {
  Ban,
  Bot,
  CircleAlert,
  CircleCheckBig,
  CircleDashed,
  GitBranch,
  Info,
  ListTree,
  Pause,
  PowerOff
} from 'lucide-react'
import type { SubagentTask, SubagentTaskResult } from '@shared/subagent-task'
import { isRecord } from '@/common/lib/type-guards'
import { cn } from '@/lib/utils'
import { PANEL_HEIGHT_XL } from '../primitives/constants'
import { ShimmerText } from '../primitives/shimmer'
import { ToolBadge, ToolHeaderRow, ToolMetaChip, type ToolBadgeTone } from '../primitives/header'
import {
  ToolPanel,
  ToolScrollPanel,
  ToolValuePreview,
  type ToolPanelTone
} from '../primitives/panel'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { Response } from '../../message/response'
import { renderToolError } from './render-error'
import { isToolError } from './shared'

type SpawnOutput = { tasks: Array<{ task: string; status: SubagentTask['status'] }> }
type AwaitOutput = {
  results: Array<{ task: string; result: SubagentTaskResult }>
  pending?: string[]
  timedOut?: boolean
}
type TasksOutput = { tasks: SubagentTask[] }
type AckOutput =
  | { steered: true; mode: 'instructed' | 'redefined' }
  | { cancelled: true }
  | { ok: true }

const STATUS_CHIP_TONE: Record<SubagentTask['status'], ToolBadgeTone> = {
  pending: 'neutral',
  running: 'info',
  blocked: 'warning',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral'
}

function panelToneForStatus(
  status: SubagentTask['status'],
  failureKind?: 'app-restart' | 'logic-error'
): ToolPanelTone {
  if (status === 'blocked') return 'warning'
  if (status === 'failed') return failureKind === 'app-restart' ? 'subtle' : 'danger'
  return 'subtle'
}

// ── Header ──────────────────────────────────────────────────────────────────
// Every card reads as one sentence about the subagent entity: a narrative
// action ("Handed off"), the objective or affected run, the agent role, and
// the run id the user can reference.

function SubagentHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as Record<string, unknown> | undefined
  const output = context.output

  const action = headerAction(context, t)
  const title = headerTitle(context, t)
  const agent = headerAgent(input, output)
  const idChip = headerIdChip(input, output)

  return (
    <ToolHeaderRow
      icon={Bot}
      label={action}
      title={title}
      state={context.state}
      badges={agent ? [{ text: agent, tone: 'info' }] : undefined}
      meta={idChip}
    />
  )
}

function headerAction(
  context: ToolRenderContext,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const name = context.shortName
  return t(`chat.tool.subagent.action.${name}`, t('chat.tool.subagent.label'))
}

function headerTitle(
  context: ToolRenderContext,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const input = context.input as Record<string, unknown> | undefined
  const output = context.output
  const task = stringValue(input?.task)
  const phase = stringValue(input?.phase)

  if (context.shortName === 'spawn') {
    const specs = Array.isArray(input?.tasks) ? (input.tasks as Array<Record<string, unknown>>) : []
    if (specs.length === 1) {
      return stringValue(specs[0]?.objective) || t('chat.tool.subagent.run')
    }
    if (specs.length > 1) return t('chat.tool.subagent.subagentCount', { count: specs.length })
  }

  if (context.shortName === 'await') {
    if (isAwaitOutput(output)) {
      if (output.results.length === 1) return output.results[0].task
      if (output.results.length > 1) {
        return t('chat.tool.subagent.subagentCount', { count: output.results.length })
      }
    }
    const ids = stringArrayValue(input?.tasks)
    if (ids.length === 1) return ids[0]
    if (ids.length > 1) return t('chat.tool.subagent.subagentCount', { count: ids.length })
  }

  if (context.shortName === 'tasks') {
    if (isTasksOutput(output) && output.tasks.length === 1) {
      return output.tasks[0].objective || t('chat.tool.subagent.run')
    }
    if (task) return task
    const status = stringValue(input?.status)
    return status
      ? t('chat.tool.subagent.filteredRuns', {
          status: t(`chat.tool.subagent.status.${status}`, status)
        })
      : t('chat.tool.subagent.allTasks')
  }

  if (context.shortName === 'report' && phase) return phase
  if (task) return task
  return t('chat.tool.subagent.run')
}

function headerAgent(
  input: Record<string, unknown> | undefined,
  output: unknown
): string | undefined {
  const inputAgent = stringValue(input?.agent)
  if (inputAgent) return inputAgent

  if (isRecord(input)) {
    const specs = Array.isArray(input.tasks) ? (input.tasks as Array<Record<string, unknown>>) : []
    if (specs.length === 1) {
      const only = stringValue(specs[0]?.agent)
      if (only) return only
    }
  }

  if (isTasksOutput(output) && output.tasks.length === 1) return output.tasks[0].agentType
  if (output && !isToolError(output) && isRecord(output)) {
    const agentType = stringValue(output.agentType)
    if (agentType) return agentType
  }
  return undefined
}

function headerIdChip(
  input: Record<string, unknown> | undefined,
  output: unknown
): React.ReactNode {
  if (isSpawnOutput(output) && output.tasks.length === 1) {
    return (
      <ToolMetaChip text={output.tasks[0].task} tone={STATUS_CHIP_TONE[output.tasks[0].status]} />
    )
  }
  if (isTasksOutput(output) && output.tasks.length === 1) {
    return (
      <ToolMetaChip text={output.tasks[0].id} tone={STATUS_CHIP_TONE[output.tasks[0].status]} />
    )
  }
  if (output && !isToolError(output) && isRecord(output) && typeof output.task === 'string') {
    return <ToolMetaChip text={output.task} tone="info" />
  }
  const task = stringValue(input?.task)
  if (task) return <ToolMetaChip text={task} tone="info" />
  return null
}

// ── Body ────────────────────────────────────────────────────────────────────

function SubagentOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const output = context.output

  const err = renderToolError(context, t('chat.tool.subagent.errors.taskFailed'))
  if (err) return err

  const isPending = context.state === 'input-streaming' || context.state === 'input-available'
  if (output === undefined) {
    if (isPending)
      return <ShimmerText text={t('chat.tool.common.running')} className="px-1 text-[0.625rem]" />
    return null
  }
  if (isToolError(output) || !isRecord(output)) return null

  if (isSpawnOutput(output)) {
    return <SpawnSummary context={context} output={output} />
  }

  if (isAwaitOutput(output)) {
    return (
      <div className="space-y-2">
        {output.results.map((entry) => (
          <ResultBlock key={entry.task} task={entry.task} result={entry.result} />
        ))}
        {output.pending && output.pending.length > 0 ? (
          <SubagentStatusLine
            icon={Pause}
            tone="warning"
            text={t('chat.tool.subagent.awaitPending', { tasks: output.pending.join(', ') })}
          />
        ) : null}
      </div>
    )
  }

  if (isTasksOutput(output)) {
    return output.tasks.length === 1 ? (
      <TaskDetail task={output.tasks[0]} />
    ) : (
      <TaskList tasks={output.tasks} />
    )
  }

  if (isAckOutput(output)) return <AckLine context={context} output={output} />

  return <ToolValuePreview value={output} />
}

function SpawnSummary({
  context,
  output
}: {
  context: ToolRenderContext
  output: SpawnOutput
}): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as Record<string, unknown> | undefined
  const specs = Array.isArray(input?.tasks) ? (input.tasks as Array<Record<string, unknown>>) : []

  return (
    <div className="space-y-1.5">
      {output.tasks.map((entry, index) => {
        const spec = specs[index]
        const objective = stringValue(spec?.objective)
        const agent = stringValue(spec?.agent)
        const dependsOn = stringArrayValue(spec?.dependsOn)
        return (
          <TaskShell key={entry.task} tone={panelToneForStatus(entry.status)}>
            <SubagentEntity
              status={entry.status}
              objective={objective}
              agent={agent}
              taskId={entry.task}
            />
            {dependsOn.length > 0 ? (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-1 px-0.5 text-[0.6875rem]',
                  STATUS_TONE['warning']
                )}
              >
                <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                <span className="shrink-0">{t('chat.tool.subagent.waitingFor')}</span>
                {dependsOn.map((depId) => (
                  <code
                    key={depId}
                    className="rounded bg-amber-500/12 px-1 py-px font-mono text-[0.5625rem] text-amber-700 dark:text-amber-300"
                  >
                    {depId}
                  </code>
                ))}
              </div>
            ) : null}
          </TaskShell>
        )
      })}
    </div>
  )
}

function ackText(
  context: ToolRenderContext,
  output: AckOutput,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if ('steered' in output) {
    return output.mode === 'redefined'
      ? t('chat.tool.subagent.ack.redefined')
      : t('chat.tool.subagent.ack.instructed')
  }
  if ('cancelled' in output) return t('chat.tool.subagent.ack.cancelled')
  const input = context.input as Record<string, unknown> | undefined
  if (context.shortName === 'report') {
    return stringValue(input?.result)
      ? t('chat.tool.subagent.ack.resultSubmitted')
      : t('chat.tool.subagent.ack.phaseReported')
  }
  return t('chat.tool.subagent.acked')
}

function AckLine({
  context,
  output
}: {
  context: ToolRenderContext
  output: AckOutput
}): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as Record<string, unknown> | undefined
  const task = stringValue(input?.task)
  const cancelled = 'cancelled' in output
  const text = ackText(context, output, t)

  // Redefining a task is destructive (all progress lost) — use amber warning
  // tone so the visual feedback matches the action's consequence.
  const redefined = 'steered' in output && output.mode === 'redefined'
  const tone: ToolBadgeTone = cancelled ? 'neutral' : redefined ? 'warning' : 'success'
  return (
    <div className={cn('flex items-center gap-1.5 px-0.5 text-[0.6875rem]', STATUS_TONE[tone])}>
      {cancelled ? (
        <Ban className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <CircleCheckBig className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {task ? (
        <ToolMetaChip text={task} tone={cancelled ? 'neutral' : redefined ? 'warning' : 'info'} />
      ) : null}
    </div>
  )
}

function ResultBlock({
  task,
  result
}: {
  task: string
  result: SubagentTaskResult
}): React.JSX.Element {
  const { t } = useTranslation()
  if (result.failed) {
    const isInterrupted = result.failureKind === 'app-restart'
    return (
      <div className="space-y-1.5">
        <ResultLabel task={task} failed />
        <ToolPanel tone={isInterrupted ? 'subtle' : 'danger'}>
          <div className="flex items-start gap-1.5 px-2.5 py-1.75">
            {isInterrupted ? (
              <PowerOff
                className="mt-px size-3 shrink-0 text-muted-foreground/55"
                aria-hidden="true"
              />
            ) : (
              <CircleAlert className="mt-px size-3 shrink-0 text-red-500/80" aria-hidden="true" />
            )}
            <p className="min-w-0 whitespace-pre-wrap break-words text-[0.625rem] leading-[1.45] text-foreground/70">
              {result.errorMessage ?? t('chat.tool.subagent.errors.taskFailed')}
            </p>
          </div>
        </ToolPanel>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <ResultLabel task={task} inferred={result.resultSource === 'inferred'} />
      <ToolScrollPanel tone="subtle" maxHeight={PANEL_HEIGHT_XL} contentClassName="px-2.5 py-2">
        <Response
          content={result.summary || ''}
          className="text-[0.75rem] leading-[1.6] text-foreground/85"
        />
      </ToolScrollPanel>
    </div>
  )
}

function ResultLabel({
  task,
  failed = false,
  inferred = false
}: {
  task: string
  failed?: boolean
  inferred?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5 px-0.5">
      <SubagentSectionLabel
        text={failed ? t('chat.tool.subagent.resultFailed') : t('chat.tool.subagent.result')}
      />
      <ToolMetaChip text={task} tone={failed ? 'danger' : 'info'} />
      {inferred ? (
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5 text-[0.5625rem] text-muted-foreground/40"
          title={t('chat.tool.subagent.resultInferred')}
        >
          <Info className="size-2.5" aria-hidden="true" />
          {t('chat.tool.subagent.inferred')}
        </span>
      ) : null}
    </div>
  )
}

function TaskDetail({ task }: { task: SubagentTask }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <TaskShell tone={panelToneForStatus(task.status, task.result?.failureKind)}>
        <SubagentEntity
          status={task.status}
          objective={task.objective}
          agent={task.agentType}
          taskId={task.id}
          phase={task.phase}
        />
        <TaskBlockLine task={task} />
      </TaskShell>
      {task.result ? <ResultBlock task={task.id} result={task.result} /> : null}
    </div>
  )
}

function TaskList({ tasks }: { tasks: SubagentTask[] }): React.JSX.Element {
  const { t } = useTranslation()
  if (tasks.length === 0) {
    return (
      <SubagentStatusLine icon={ListTree} tone="neutral" text={t('chat.tool.subagent.noTasks')} />
    )
  }
  return (
    <div className="space-y-1.5">
      {tasks.map((task) => (
        <TaskShell
          key={task.id}
          tone={panelToneForStatus(task.status, task.result?.failureKind)}
          compact
        >
          <SubagentEntity
            status={task.status}
            objective={task.objective}
            agent={task.agentType}
            taskId={task.id}
            phase={task.phase}
            truncate
          />
          <TaskBlockLine task={task} />
        </TaskShell>
      ))}
    </div>
  )
}

// One subagent, rendered as an entity. The id chip leads each line as the
// stable handle the user references; the objective is the hero text beside it;
// the agent role and live phase sit on a single quiet meta row. The status
// icon + tone carry status, so the status word is dropped to save density.
function SubagentEntity({
  status,
  objective,
  agent,
  taskId,
  phase,
  truncate = false
}: {
  status: SubagentTask['status']
  objective?: string
  agent?: string
  taskId: string
  phase?: string
  truncate?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { Icon, spin } = statusIcon(status)
  const objectiveText = objective || t('chat.tool.subagent.run')
  const isActive = status === 'running' || status === 'pending' || status === 'blocked'
  const StatusGlyph = (
    <Icon
      className={cn('size-3.5 shrink-0', STATUS_ICON_TONE[status], spin && 'animate-spin')}
      aria-hidden="true"
    />
  )

  // Dense single-line row for multi-task lists: glyph · id · objective · agent.
  if (truncate) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        {StatusGlyph}
        <ToolMetaChip text={taskId} tone={STATUS_CHIP_TONE[status]} className="shrink-0" />
        <p
          className={cn(
            'min-w-0 flex-1 truncate text-[0.75rem] leading-[1.5]',
            isActive ? 'text-foreground/85' : 'text-foreground/60'
          )}
          title={objectiveText}
        >
          {objectiveText}
        </p>
        {phase ? (
          <span
            className="min-w-0 flex-1 truncate text-[0.625rem] text-foreground/45"
            title={phase}
          >
            {phase}
          </span>
        ) : null}
        <ToolBadge text={agent || t('chat.tool.subagent.run')} tone="info" className="shrink-0" />
      </div>
    )
  }

  // Two-line hero layout for a single highlighted subagent.
  return (
    <div className="space-y-0.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5">{StatusGlyph}</span>
        <ToolMetaChip text={taskId} tone={STATUS_CHIP_TONE[status]} className="mt-px shrink-0" />
        <p className="min-w-0 flex-1 text-[0.75rem] font-medium leading-[1.5] text-foreground/88">
          {objectiveText}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-5">
        <ToolBadge text={agent || t('chat.tool.subagent.run')} tone="info" />
        {phase ? (
          <span
            className="min-w-0 flex-1 truncate text-[0.625rem] text-foreground/50"
            title={phase}
          >
            {phase}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function TaskBlockLine({ task }: { task: SubagentTask }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (task.block?.kind === 'dependency') {
    // Render each blocker as a labelled chip so the agent and user can identify
    // the exact dependency at a glance without inspecting the raw text.
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 px-0.5 text-[0.6875rem]',
          STATUS_TONE['warning']
        )}
      >
        <GitBranch className="size-3 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{t('chat.tool.subagent.blockedBy')}</span>
        {task.block.taskIds.map((depId) => (
          <code
            key={depId}
            className="rounded bg-amber-500/12 px-1 py-px font-mono text-[0.5625rem] text-amber-700 dark:text-amber-300"
          >
            {depId}
          </code>
        ))}
      </div>
    )
  }
  if (task.block?.kind === 'approval') {
    return (
      <SubagentStatusLine
        icon={Pause}
        tone="warning"
        text={t('chat.tool.subagent.blockedApproval')}
      />
    )
  }
  if (task.dependsOn.length > 0 && task.status === 'pending') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 px-0.5 text-[0.6875rem]',
          STATUS_TONE['warning']
        )}
      >
        <GitBranch className="size-3 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{t('chat.tool.subagent.waitingFor')}</span>
        {task.dependsOn.map((depId) => (
          <code
            key={depId}
            className="rounded bg-amber-500/12 px-1 py-px font-mono text-[0.5625rem] text-amber-700 dark:text-amber-300"
          >
            {depId}
          </code>
        ))}
      </div>
    )
  }
  return null
}

function TaskShell({
  children,
  tone = 'subtle',
  compact = false
}: {
  children: React.ReactNode
  tone?: ToolPanelTone
  compact?: boolean
}): React.JSX.Element {
  return (
    <ToolPanel tone={tone} className={cn('space-y-1.5', compact ? 'px-2.5 py-1.5' : 'px-2.5 py-2')}>
      {children}
    </ToolPanel>
  )
}

function SubagentSectionLabel({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="px-0.5 text-[0.5625rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
      {text}
    </div>
  )
}

const STATUS_TONE: Record<ToolBadgeTone, string> = {
  neutral: 'text-foreground/55',
  info: 'text-primary/75',
  success: 'text-emerald-600/90 dark:text-emerald-400/90',
  warning: 'text-amber-600/90 dark:text-amber-400/90',
  danger: 'text-red-600/90 dark:text-red-400/90'
}

const STATUS_ICON_TONE: Record<SubagentTask['status'], string> = {
  pending: 'text-muted-foreground/70',
  running: 'text-primary',
  blocked: 'text-amber-500',
  done: 'text-emerald-500/85',
  failed: 'text-red-500',
  cancelled: 'text-muted-foreground/70'
}

function statusIcon(status: SubagentTask['status']): { Icon: React.ElementType; spin?: boolean } {
  switch (status) {
    case 'done':
      return { Icon: CircleCheckBig }
    case 'failed':
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

function SubagentStatusLine({
  icon: Icon,
  text,
  tone = 'neutral'
}: {
  icon: React.ElementType
  text: string
  tone?: ToolBadgeTone
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5 px-0.5 text-[0.6875rem]', STATUS_TONE[tone])}>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{text}</span>
    </div>
  )
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function isSpawnOutput(output: unknown): output is SpawnOutput {
  return (
    isRecord(output) &&
    Array.isArray(output.tasks) &&
    output.tasks.length > 0 &&
    output.tasks.every((entry) => isRecord(entry) && typeof entry.task === 'string')
  )
}

function isAwaitOutput(output: unknown): output is AwaitOutput {
  return (
    isRecord(output) &&
    Array.isArray(output.results) &&
    output.results.every(
      (entry) => isRecord(entry) && isRecord((entry as AwaitOutput['results'][number]).result)
    )
  )
}

function isTasksOutput(output: unknown): output is TasksOutput {
  return (
    isRecord(output) &&
    Array.isArray(output.tasks) &&
    output.tasks.every((entry) => isRecord(entry) && typeof entry.id === 'string')
  )
}

function isAckOutput(output: Record<string, unknown>): output is AckOutput {
  return output.steered === true || output.cancelled === true || output.ok === true
}

export const subagentRenderer: ToolRenderer = {
  Header: SubagentHeader,
  Output: SubagentOutputComp,
  renderWhenPending: true
}
