import { useTranslation } from 'react-i18next'
import { Plug } from 'lucide-react'
import { ToolBadge, ToolErrorState, ToolHeaderRow, ToolValuePreview } from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'

interface DynamicNamespace {
  kind: 'mcp' | 'plain'
  server?: string
  tool: string
}

function parseDynamicName(toolName: string): DynamicNamespace {
  if (toolName.startsWith('mcp__')) {
    const segments = toolName.split('__')
    if (segments.length >= 3) {
      return { kind: 'mcp', server: segments[1], tool: segments.slice(2).join('__') }
    }
  }
  return { kind: 'plain', tool: toolName }
}

function DynamicHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const ns = parseDynamicName(context.toolName)
  const badges =
    ns.kind === 'mcp' ? [{ text: `mcp:${ns.server ?? '?'}`, tone: 'info' as const }] : undefined

  return (
    <ToolHeaderRow
      icon={Plug}
      label={t('chat.tool.dynamic.label')}
      title={ns.tool}
      state={context.state}
      {...(badges ? { badges } : {})}
      titleClassName="font-mono text-foreground/85"
    />
  )
}

function DynamicOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (context.state === 'output-error') {
    return (
      <ToolErrorState message={context.errorText ?? t('chat.tool.dynamic.errors.toolFailed')} />
    )
  }
  const output = context.output
  const input = context.input
  if (output === undefined && input === undefined) return null

  return (
    <div className="space-y-1.5">
      {input !== undefined && (
        <div className="space-y-1">
          <ToolBadge text={t('chat.tool.dynamic.input')} tone="neutral" />
          <ToolValuePreview value={input} maxHeight="180px" />
        </div>
      )}
      {output !== undefined && (
        <div className="space-y-1">
          <ToolBadge text={t('chat.tool.dynamic.output')} tone="info" />
          <ToolValuePreview value={output} />
        </div>
      )}
    </div>
  )
}

export const dynamicRenderer: ToolRenderer = {
  Header: DynamicHeader,
  Output: DynamicOutputComp
}
