import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import type { TanzoTools } from '@shared/agent-message'
import { ToolHeaderRow } from '../primitives/header'
import { ToolPathLine } from '../primitives/panel'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { isToolError } from './shared'

/** Renders the `browserOpen` tool. All other page interaction is handled by the
 * chrome-devtools-mcp server, whose tools render through the dynamic renderer. */
function urlOf(context: ToolRenderContext): string {
  const input = (context.input ?? {}) as Record<string, unknown>
  return typeof input.url === 'string' ? input.url : ''
}

function BrowserHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <ToolHeaderRow
      icon={Globe}
      label={t('chat.tool.browser.label')}
      title={
        urlOf(context) ||
        t('chat.tool.browser.actions.browserOpen', { defaultValue: 'Open browser' })
      }
      state={context.state}
    />
  )
}

function BrowserOutput({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const err = renderToolError(context, t('chat.tool.browser.errors.failed'))
  if (err) return err

  const output = context.output
  if (output === undefined || isToolError(output)) return null
  const res = output as Exclude<TanzoTools['browserOpen']['output'], { error: true }>
  return <ToolPathLine label={t('chat.tool.browser.url')} value={res.url} />
}

export const browserRenderer: ToolRenderer = {
  Header: BrowserHeader,
  Output: BrowserOutput,
  renderWhenPending: true
}
