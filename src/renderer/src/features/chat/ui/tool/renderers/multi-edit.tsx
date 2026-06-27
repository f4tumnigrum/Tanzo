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

type EditSpec = Partial<TanzoTools['multiEdit']['input']['edits'][number]>
type MultiEditInput = Partial<TanzoTools['multiEdit']['input']>
type MultiEditOutput = Exclude<TanzoTools['multiEdit']['output'], ToolError>

interface DiffStats {
  additions: number
  deletions: number
  lines: CodeViewLine[]
}

function buildDiff(edits: EditSpec[], locations?: MultiEditOutput['locations']): DiffStats {
  let additions = 0
  let deletions = 0
  const lines: CodeViewLine[] = []
  edits.forEach((edit, index) => {
    const removed = edit.oldText ? edit.oldText.split('\n') : []
    const added = edit.newText ? edit.newText.split('\n') : []
    const startLine = locations?.[index]?.startLine ?? locations?.[index]?.startLines?.[0]
    if (index > 0) lines.push({ text: '' })
    for (let i = 0; i < removed.length; i++) {
      lines.push({
        ...(startLine ? { lineNumber: startLine + i } : {}),
        text: `-${removed[i]}`,
        tone: 'remove'
      })
    }
    for (let i = 0; i < added.length; i++) {
      lines.push({
        ...(startLine ? { lineNumber: startLine + i } : {}),
        text: `+${added[i]}`,
        tone: 'add'
      })
    }
    additions += added.length
    deletions += removed.length
  })
  return { additions, deletions, lines }
}

function MultiEditHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as MultiEditInput | undefined
  const { fileName } = splitDirAndFile(input?.path)
  const edits = input?.edits ?? []
  const stats = edits.length ? buildDiff(edits) : null
  const badges: Array<{ text: string; tone?: 'info' }> = []
  if (edits.length)
    badges.push({ text: t('chat.tool.fileEdit.edits', { count: edits.length }), tone: 'info' })

  return (
    <ToolHeaderRow
      icon={FilePen}
      label="MultiEdit"
      title={fileName || '·'}
      state={context.state}
      badges={badges}
      meta={stats ? <ToolDiffMeta additions={stats.additions} deletions={stats.deletions} /> : null}
    />
  )
}

function MultiEditOutputComp({
  context
}: {
  context: ToolRenderContext
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const input = context.input as MultiEditInput | undefined
  const output = context.output
  const result = output !== undefined && !isToolError(output) ? (output as MultiEditOutput) : null
  const locations = result?.locations
  const stats = useMemo(() => buildDiff(input?.edits ?? [], locations), [input?.edits, locations])

  const err = renderToolError(context, t('chat.tool.fileEdit.errors.editFailed'))
  if (err) return err
  if (stats.lines.length === 0) return null
  return (
    <>
      <SimpleCodeView
        lines={stats.lines}
        maxLines={120}
        maxHeight={PANEL_HEIGHT_LG}
        wrapLongLines
        flush
      />
      {result ? (
        <ToolMetaLine className="border-t border-border/10 px-2.5 py-1">
          {t('chat.tool.fileEdit.replacements', { count: result.replacements })}
          {input?.edits?.some((edit) => edit.replaceAll)
            ? ` · ${t('chat.tool.fileEdit.replaceAll')}`
            : ''}
        </ToolMetaLine>
      ) : null}
    </>
  )
}

export const multiEditRenderer: ToolRenderer = {
  Header: MultiEditHeader,
  Output: MultiEditOutputComp,
  renderWhenPending: true,
  fullBleed: true
}
