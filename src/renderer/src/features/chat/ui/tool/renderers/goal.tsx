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
interface GoalOutput {
  updated: true
  status: GoalStatus
}

const STATUS_TONE: Record<GoalStatus, ToolBadgeTone> = {
  complete: 'success',
  blocked: 'danger'
}

function goalStatus(context: ToolRenderContext): GoalStatus | null {
  const output = context.output
  if (output !== undefined && !isToolError(output)) return (output as GoalOutput).status
  const input = context.input as GoalInput | undefined
  return input?.status ?? null
}

function GoalHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const status = goalStatus(context)
  const badge = status
    ? { text: t(`chat.tool.goal.status.${status}`), tone: STATUS_TONE[status] }
    : null
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
