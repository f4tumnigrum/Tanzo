import { FilePen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TanzoTools, ToolError } from '@shared/agent-message'
import {
  PANEL_HEIGHT_LG,
  SimpleCodeView,
  ToolDiffMeta,
  ToolHeaderRow,
  ToolMetaLine,
  type CodeViewLine
} from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { isToolError, splitDirAndFile } from './shared'

type FileEditInput = Partial<TanzoTools['fileEdit']['input']>
type FileEditOutput = Exclude<TanzoTools['fileEdit']['output'], ToolError>

interface DiffStats {
  additions: number
  deletions: number
  lines: CodeViewLine[]
}

function buildDiff(oldText: string, newText: string, startLine?: number): DiffStats {
  const removed = oldText ? oldText.split('\n') : []
  const added = newText ? newText.split('\n') : []
  const lines: CodeViewLine[] = [
    ...removed.map(
      (text, index): CodeViewLine => ({
        ...(startLine ? { lineNumber: startLine + index } : {}),
        text: `-${text}`,
        tone: 'remove'
      })
    ),
    ...added.map(
      (text, index): CodeViewLine => ({
        ...(startLine ? { lineNumber: startLine + index } : {}),
        text: `+${text}`,
        tone: 'add'
      })
    )
  ]
  return { additions: added.length, deletions: removed.length, lines }
}

function FileEditHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const input = context.input as FileEditInput | undefined
  const { fileName } = splitDirAndFile(input?.path)
  const stats =
    input?.oldText !== undefined || input?.newText !== undefined
      ? buildDiff(input?.oldText ?? '', input?.newText ?? '')
      : null

  return (
    <ToolHeaderRow
      icon={FilePen}
      label="Edit"
      title={fileName || '·'}
      state={context.state}
      meta={stats ? <ToolDiffMeta additions={stats.additions} deletions={stats.deletions} /> : null}
    />
  )
}

function FileEditOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const input = context.input as FileEditInput | undefined
  const output = context.output
  const result = output !== undefined && !isToolError(output) ? (output as FileEditOutput) : null
  const startLine = result?.startLine
  const stats = useMemo(
    () => buildDiff(input?.oldText ?? '', input?.newText ?? '', startLine),
    [input?.oldText, input?.newText, startLine]
  )

  const err = renderToolError(context, t('chat.tool.fileEdit.errors.editFailed'))
  if (err) return err
  if (stats.lines.length === 0) return null
  return (
    <>
      <SimpleCodeView
        lines={stats.lines}
        maxLines={80}
        maxHeight={PANEL_HEIGHT_LG}
        wrapLongLines
        flush
      />
      {result ? (
        <ToolMetaLine className="border-t border-border/10 px-2.5 py-1">
          {t('chat.tool.fileEdit.replacements', { count: result.replacements })}
          {input?.replaceAll ? ` · ${t('chat.tool.fileEdit.replaceAll')}` : ''}
        </ToolMetaLine>
      ) : null}
    </>
  )
}

export const fileEditRenderer: ToolRenderer = {
  Header: FileEditHeader,
  Output: FileEditOutputComp,
  renderWhenPending: true,
  fullBleed: true
}
