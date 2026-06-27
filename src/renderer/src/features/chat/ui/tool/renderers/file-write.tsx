import { useTranslation } from 'react-i18next'
import { FilePlus2 } from 'lucide-react'
import { HighlightedCodeView, PANEL_HEIGHT_LG, ToolHeaderRow, ToolMetaChip } from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { formatBytes, isToolError, splitDirAndFile } from './shared'

interface FileWriteInput {
  path?: string
  content?: string
}
interface FileWriteOutput {
  applied: boolean
  bytes: number
}

function FileWriteHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const input = context.input as FileWriteInput | undefined
  const output = context.output
  const { fileName } = splitDirAndFile(input?.path)
  const sizeChip =
    output && !isToolError(output) ? formatBytes((output as FileWriteOutput).bytes) : undefined

  return (
    <ToolHeaderRow
      icon={FilePlus2}
      label="Write"
      title={fileName || '·'}
      state={context.state}
      meta={sizeChip ? <ToolMetaChip text={sizeChip} /> : null}
    />
  )
}

function FileWriteOutputComp({
  context
}: {
  context: ToolRenderContext
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const err = renderToolError(context, t('chat.tool.fileWrite.errors.writeFailed'), {
    className: 'm-2.5'
  })
  if (err) return err
  const input = context.input as FileWriteInput | undefined
  if (!input?.content) return null

  return (
    <HighlightedCodeView
      code={input.content}
      path={input.path}
      maxLines={120}
      maxHeight={PANEL_HEIGHT_LG}
      disclosureKey={`wrap:${context.toolCallId}`}
      flush
    />
  )
}

export const fileWriteRenderer: ToolRenderer = {
  Header: FileWriteHeader,
  Output: FileWriteOutputComp,
  renderWhenPending: true,
  fullBleed: true
}
