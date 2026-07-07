import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { ToolHeaderRow, type ToolBadgeTone } from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { isToolError } from './shared'

type GoalStatus = 'complete' | 'blocked'
interface GoalInput {
  status?: GoalStatus
}
type GoalOutput =
  | { updated: true; status: GoalStatus }
  | { recorded: true; attempts: number; required: number; message: string }

const STATUS_TONE: Record<GoalStatus, ToolBadgeTone> = {
  complete: 'success',
  blocked: 'danger'
}

type GoalBadge = { text: string; tone: ToolBadgeTone }

function goalOutput(context: ToolRenderContext): GoalOutput | null {
  const output = context.output
  if (output === undefined || isToolError(output)) return null
  return output as GoalOutput
}

function useGoalBadge(context: ToolRenderContext): GoalBadge | null {
  const { t } = useTranslation()
  const output = goalOutput(context)
  if (output && 'recorded' in output) {
    return {
      text: t('chat.tool.goal.status.recorded', {
        attempts: output.attempts,
        required: output.required
      }),
      tone: 'warning'
    }
  }
  const status = output?.status ?? (context.input as GoalInput | undefined)?.status ?? null
  return status ? { text: t(`chat.tool.goal.status.${status}`), tone: STATUS_TONE[status] } : null
}

function GoalHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const badge = useGoalBadge(context)
  return (
    <ToolHeaderRow
      icon={Target}
      label={t('chat.tool.goal.label')}
      state={context.state}
      badges={badge ? [badge] : undefined}
    />
  )
}

function GoalOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  return renderToolError(context, t('chat.tool.goal.errors.updateFailed'), { className: 'm-2.5' })
}

export const goalRenderer: ToolRenderer = {
  Header: GoalHeader,
  Output: GoalOutputComp,
  renderWhenPending: true
}
