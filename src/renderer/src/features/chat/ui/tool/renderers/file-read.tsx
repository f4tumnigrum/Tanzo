import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import type { TanzoTools, ToolError } from '@shared/agent-message'
import {
  HighlightedCodeView,
  PANEL_HEIGHT_LG,
  ToolHeaderRow,
  ToolMetaLine,
  ToolMetaChip
} from '../primitives'
import type { ToolRenderContext } from '../render-context'
import type { ToolRenderer } from '../renderer-types'
import { renderToolError } from './render-error'
import { formatBytes, isToolError, splitDirAndFile } from './shared'

type FileReadInput = Partial<TanzoTools['fileRead']['input']>
type FileReadOutput = Exclude<TanzoTools['fileRead']['output'], ToolError>
type ImageOutput = Extract<FileReadOutput, { kind: 'image' }>
type NotebookOutput = Extract<FileReadOutput, { kind: 'notebook' }>
type TextOutput = Exclude<FileReadOutput, ImageOutput | NotebookOutput>
type TFn = ReturnType<typeof useTranslation>['t']

function isImage(output: unknown): output is ImageOutput {
  return typeof output === 'object' && output !== null && (output as ImageOutput).kind === 'image'
}
function isNotebook(output: unknown): output is NotebookOutput {
  return (
    typeof output === 'object' && output !== null && (output as NotebookOutput).kind === 'notebook'
  )
}

function lineRange(content: string): string | undefined {
  const numbers = content
    .split('\n')
    .map((line) => {
      const tab = line.indexOf('\t')
      if (tab <= 0) return undefined
      const prefix = line.slice(0, tab)
      return /^\d+$/.test(prefix) ? Number(prefix) : undefined
    })
    .filter((line): line is number => line !== undefined)
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  if (first === undefined || last === undefined) return undefined
  return first === last ? `L${first}` : `L${first}-L${last}`
}

function textMeta(output: TextOutput, t: TFn): string {
  return output.totalLinesKnown === false
    ? t('chat.tool.fileRead.linesPlus', { count: output.totalLines })
    : t('chat.tool.fileRead.lines', { count: output.totalLines })
}

function FileReadHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as FileReadInput | undefined
  const output = context.output
  const path = input?.path ?? ''
  const { fileName } = splitDirAndFile(path)
  let meta: string | undefined
  if (output && !isToolError(output)) {
    if (isImage(output)) meta = formatBytes(output.bytes)
    else if (isNotebook(output)) {
      meta = t('chat.tool.fileRead.cells', { count: output.cells })
    } else {
      const result = output as TextOutput
      meta = lineRange(result.content)
    }
  }

  return (
    <ToolHeaderRow
      icon={FileText}
      label="Read"
      title={fileName || '·'}
      state={context.state}
      meta={meta ? <ToolMetaChip text={meta} /> : null}
    />
  )
}

function FileReadOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const err = renderToolError(context, t('chat.tool.fileRead.errors.readFailed'), {
    className: 'm-2.5'
  })
  if (err) return err
  const output = context.output
  if (output === undefined) return null

  if (isImage(output)) {
    return (
      <div className="flex justify-center p-2">
        <img
          src={`data:${output.mediaType};base64,${output.data}`}
          alt=""
          className="max-h-80 max-w-full rounded-md border border-border/10"
        />
      </div>
    )
  }

  const result = output as TextOutput | NotebookOutput
  const input = context.input as FileReadInput | undefined
  const rawLines = result.content.split('\n')
  const firstTab = rawLines[0]?.indexOf('\t') ?? -1
  const firstPrefix =
    firstTab > 0 && /^\d+$/.test(rawLines[0]!.slice(0, firstTab))
      ? Number(rawLines[0]!.slice(0, firstTab))
      : undefined
  const startLine = firstPrefix ?? input?.startLine ?? 1
  const codeLines = rawLines.map((text) => {
    const tab = text.indexOf('\t')
    if (tab > 0 && /^\d+$/.test(text.slice(0, tab))) return text.slice(tab + 1)
    return text
  })
  const isNotebookOut = isNotebook(output)
  const meta = isNotebookOut
    ? [
        t('chat.tool.fileRead.cells', { count: (result as NotebookOutput).cells }),
        result.truncated ? t('chat.tool.fileRead.truncated') : null
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        textMeta(result as TextOutput, t),
        (result as TextOutput).hasMore ? t('chat.tool.fileRead.moreAvailable') : null
      ]
        .filter(Boolean)
        .join(' · ')
  return (
    <>
      <HighlightedCodeView
        code={codeLines.join('\n')}
        {...(isNotebookOut ? { language: 'python' } : { path: input?.path })}
        startLine={startLine}
        maxLines={120}
        maxHeight={PANEL_HEIGHT_LG}
        disclosureKey={`wrap:${context.toolCallId}`}
        flush
      />
      {meta ? (
        <ToolMetaLine className="border-t border-border/10 px-2.5 py-1">{meta}</ToolMetaLine>
      ) : null}
    </>
  )
}

export const fileReadRenderer: ToolRenderer = {
  Header: FileReadHeader,
  Output: FileReadOutputComp,
  fullBleed: true
}
