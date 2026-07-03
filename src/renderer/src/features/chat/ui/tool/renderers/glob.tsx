import { useTranslation } from 'react-i18next'
import { FileSearch } from 'lucide-react'
import type { TanzoTools, ToolError } from '@shared/agent-message'
import {
  PANEL_HEIGHT_MD,
  ToolEmptyState,
  ToolHeaderRow,
  ToolMetaLine,
  ToolMetaChip,
  ToolScrollPanel
} from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { isToolError, splitDirAndFile } from './shared'

type GlobInput = Partial<TanzoTools['glob']['input']>
type GlobOutput = Exclude<TanzoTools['glob']['output'], ToolError>
type TFn = ReturnType<typeof useTranslation>['t']

function GlobHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as GlobInput | undefined
  const output = context.output
  const pattern = input?.pattern ?? ''
  const count = output && !isToolError(output) ? (output as GlobOutput).paths.length : undefined

  return (
    <ToolHeaderRow
      icon={FileSearch}
      label="Glob"
      title={pattern || '·'}
      state={context.state}
      meta={
        typeof count === 'number' ? (
          <ToolMetaChip text={t('chat.tool.glob.hitsCount', { count })} />
        ) : null
      }
    />
  )
}

function GlobQueryMeta({
  input,
  t
}: {
  input: GlobInput | undefined
  t: TFn
}): React.JSX.Element | null {
  const parts: string[] = []
  if (input?.directory) parts.push(`dir ${input.directory}`)
  if (input?.includeIgnored) parts.push(t('chat.tool.glob.includingIgnored'))
  if (typeof input?.offset === 'number' && input.offset > 0) parts.push(`offset ${input.offset}`)
  if (typeof input?.limit === 'number') parts.push(`limit ${input.limit}`)
  if (parts.length === 0) return null
  return (
    <ToolMetaLine className="border-b border-border/8 px-2.5 py-1">
      {parts.join(' · ')}
    </ToolMetaLine>
  )
}

function GlobOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const err = renderToolError(context, t('chat.tool.glob.errors.globFailed'), {
    className: 'm-2.5'
  })
  if (err) return err
  const output = context.output
  if (output === undefined) return null

  const result = output as GlobOutput
  const input = context.input as GlobInput | undefined
  if (result.paths.length === 0) {
    return <ToolEmptyState className="m-2.5" message={t('chat.tool.glob.noMatches')} />
  }
  return (
    <ToolScrollPanel flush tone="subtle" maxHeight={PANEL_HEIGHT_MD}>
      <GlobQueryMeta input={input} t={t} />
      <ul className="divide-y divide-border/8">
        {result.paths.map((path) => {
          const { fileName, dir } = splitDirAndFile(path)
          return (
            <li
              key={path}
              className="flex items-center gap-1 px-2.5 py-1 font-mono text-[length:var(--code-font-size)] leading-[1.4] hover:bg-background/24"
            >
              {dir && <span className="truncate text-foreground/40">{dir}/</span>}
              <span className="min-w-0 flex-1 truncate text-foreground/85">{fileName || path}</span>
            </li>
          )
        })}
      </ul>
      {result.truncated && (
        <p className="border-t border-border/10 px-2.5 py-1 text-[0.5625rem] text-muted-foreground">
          {t('chat.tool.glob.truncated')}
        </p>
      )}
    </ToolScrollPanel>
  )
}

export const globRenderer: ToolRenderer = {
  Header: GlobHeader,
  Output: GlobOutputComp,
  fullBleed: true
}
