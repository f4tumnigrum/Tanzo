import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import type { TanzoTools } from '@shared/agent-message'
import { PANEL_HEIGHT_LG } from '../primitives/constants'
import { ToolHeaderRow } from '../primitives/header'
import { ToolPathLine, ToolPreText, ToolScrollPanel } from '../primitives/panel'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { isToolError } from './shared'

type BrowserToolName =
  | 'browserSnapshot'
  | 'browserNavigate'
  | 'browserClick'
  | 'browserType'
  | 'browserScroll'
  | 'browserBack'
  | 'browserForward'
  | 'browserReadText'
  | 'browserScreenshot'
  | 'browserTabs'
  | 'browserActivateTab'
  | 'browserWaitFor'
  | 'browserSelect'
  | 'browserPressKey'
  | 'browserHover'

/** A short human-facing summary of the browser action's target. */
function targetOf(context: ToolRenderContext): string {
  const name = context.shortName as BrowserToolName
  const input = (context.input ?? {}) as Record<string, unknown>
  switch (name) {
    case 'browserNavigate':
      return typeof input.url === 'string' ? input.url : ''
    case 'browserClick':
    case 'browserType':
    case 'browserHover':
    case 'browserSelect':
      return typeof input.ref === 'string' ? `@${String(input.ref).replace(/^@/, '')}` : ''
    case 'browserPressKey':
      return typeof input.key === 'string' ? input.key : ''
    case 'browserActivateTab':
      return typeof input.tabId === 'string' ? input.tabId : ''
    case 'browserWaitFor':
      return typeof input.ms === 'number' ? `${input.ms}ms` : ''
    default:
      return ''
  }
}

function BrowserHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const name = context.shortName as BrowserToolName
  const label = t(`chat.tool.browser.actions.${name}`, { defaultValue: name })
  return (
    <ToolHeaderRow
      icon={Globe}
      label={t('chat.tool.browser.label')}
      title={targetOf(context) || label}
      subtitle={targetOf(context) ? label : undefined}
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
  const name = context.shortName as BrowserToolName

  if (name === 'browserSnapshot') {
    const snap = output as Exclude<TanzoTools['browserSnapshot']['output'], { error: true }>
    return (
      <div className="space-y-1.5">
        <ToolPathLine label={t('chat.tool.browser.url')} value={snap.url} />
        <ToolScrollPanel tone="subtle" maxHeight={PANEL_HEIGHT_LG} contentClassName="px-2.5 py-2">
          <ToolPreText text={snap.tree || t('chat.tool.browser.emptySnapshot')} />
        </ToolScrollPanel>
      </div>
    )
  }

  if (name === 'browserReadText') {
    const res = output as Exclude<TanzoTools['browserReadText']['output'], { error: true }>
    return (
      <ToolScrollPanel tone="subtle" maxHeight={PANEL_HEIGHT_LG} contentClassName="px-2.5 py-2">
        <ToolPreText text={res.text || t('chat.tool.browser.emptyText')} />
      </ToolScrollPanel>
    )
  }

  if (name === 'browserScreenshot') {
    const res = output as Exclude<TanzoTools['browserScreenshot']['output'], { error: true }>
    return (
      <div className="overflow-hidden rounded-md border border-border/40">
        <img
          src={res.dataUrl}
          alt={t('chat.tool.browser.screenshotAlt')}
          className="block max-h-80 w-full object-contain"
        />
      </div>
    )
  }

  if (name === 'browserTabs') {
    const res = output as Exclude<TanzoTools['browserTabs']['output'], { error: true }>
    return (
      <div className="space-y-1 px-1">
        {res.tabs.map((tab) => (
          <ToolPathLine
            key={tab.tabId}
            label={tab.active ? t('chat.tool.browser.activeTab') : tab.tabId}
            value={tab.title || tab.url}
          />
        ))}
      </div>
    )
  }

  return null
}

export const browserRenderer: ToolRenderer = {
  Header: BrowserHeader,
  Output: BrowserOutput,
  renderWhenPending: true
}
