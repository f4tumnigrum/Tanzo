import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
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

type GrepInput = Partial<TanzoTools['grep']['input']>
type GrepOutput = Exclude<TanzoTools['grep']['output'], ToolError>
type GrepMatch = Extract<GrepOutput, { mode: 'content' }>['matches'][number]

type TFn = ReturnType<typeof useTranslation>['t']

function groupByFile(matches: GrepMatch[]): Array<{ file: string; rows: GrepMatch[] }> {
  const order: string[] = []
  const byFile = new Map<string, GrepMatch[]>()
  for (const m of matches) {
    let rows = byFile.get(m.file)
    if (!rows) {
      rows = []
      byFile.set(m.file, rows)
      order.push(m.file)
    }
    rows.push(m)
  }
  return order.map((file) => ({ file, rows: byFile.get(file)! }))
}

function FileLabel({ path, count }: { path: string; count?: number }): React.JSX.Element {
  const { fileName, dir } = splitDirAndFile(path)
  return (
    <div className="flex items-center gap-1 px-2.5 py-1 font-mono text-[0.625rem] leading-[1.4]">
      {dir && <span className="truncate text-foreground/40">{dir}/</span>}
      <span className="min-w-0 flex-1 truncate text-foreground/75">{fileName || path}</span>
      {typeof count === 'number' && (
        <span className="shrink-0 tabular-nums text-muted-foreground/70">{count}</span>
      )}
    </div>
  )
}

function buildMatcher(input: GrepInput | undefined): { source: string; flags: string } | null {
  const pattern = input?.pattern
  if (!pattern) return null
  try {
    const flags = `g${input?.caseInsensitive ? 'i' : ''}`
    const probe = new RegExp(pattern, flags)
    if (probe.exec('a\nb c')?.[0] === '') return null
    return { source: pattern, flags }
  } catch {
    return null
  }
}

function MatchText({
  text,
  matcher
}: {
  text: string
  matcher: { source: string; flags: string } | null
}): React.JSX.Element {
  if (!matcher) return <span className="text-foreground/85">{text}</span>
  const re = new RegExp(matcher.source, matcher.flags)
  const parts: React.ReactNode[] = []
  let last = 0
  let count = 0
  for (let m = re.exec(text); m !== null && count < 50; m = re.exec(text)) {
    if (m[0] === '') {
      re.lastIndex += 1
      continue
    }
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <mark
        key={`${m.index}-${count}`}
        className="rounded-[var(--radius-sm)] bg-primary/[0.18] px-0.5 text-foreground ring-1 ring-inset ring-primary/20"
      >
        {m[0]}
      </mark>
    )
    last = m.index + m[0].length
    count += 1
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className="text-foreground/85">{parts}</span>
}

function GrepHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const input = context.input as GrepInput | undefined
  const output = context.output
  const pattern = input?.pattern ?? ''
  let meta: string | undefined
  if (output && !isToolError(output)) {
    const result = output as GrepOutput
    if (result.mode === 'count') meta = t('chat.tool.grep.matchesCount', { count: result.count })
    else if (result.mode === 'files')
      meta = t('chat.tool.grep.filesCount', { count: result.files.length })
    else meta = t('chat.tool.grep.matchesCount', { count: result.matches.length })
  }

  return (
    <ToolHeaderRow
      icon={Search}
      label="Grep"
      title={pattern || '·'}
      state={context.state}
      titleClassName="font-mono text-foreground/85"
      meta={meta ? <ToolMetaChip text={meta} /> : null}
    />
  )
}

function GrepQueryMeta({
  input,
  t
}: {
  input: GrepInput | undefined
  t: TFn
}): React.JSX.Element | null {
  const parts: string[] = []
  if (input?.directory) parts.push(`dir ${input.directory}`)
  if (input?.includeGlob) parts.push(`glob ${input.includeGlob}`)
  if (input?.mode && input.mode !== 'content') parts.push(input.mode)
  if (input?.type) parts.push(`type ${input.type}`)
  if (input?.caseInsensitive) parts.push(t('chat.tool.grep.caseInsensitive'))
  if (input?.multiline) parts.push(t('chat.tool.grep.multiline'))
  if (typeof input?.contextBefore === 'number' || typeof input?.contextAfter === 'number') {
    parts.push(`context ${input.contextBefore ?? 0}/${input.contextAfter ?? 0}`)
  }
  if (typeof input?.limit === 'number') parts.push(`limit ${input.limit}`)
  if (typeof input?.offset === 'number' && input.offset > 0) parts.push(`offset ${input.offset}`)
  if (parts.length === 0) return null
  return (
    <ToolMetaLine className="border-b border-border/8 px-2.5 py-1">
      {parts.join(' · ')}
    </ToolMetaLine>
  )
}

function GrepOutputComp({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  const err = renderToolError(context, t('chat.tool.grep.errors.searchFailed'), {
    className: 'm-2.5'
  })
  if (err) return err
  const output = context.output
  if (output === undefined) return null

  const result = output as GrepOutput
  const input = context.input as GrepInput | undefined
  if (result.mode === 'count') {
    return (
      <div>
        <GrepQueryMeta input={input} t={t} />
        <p className="px-2.5 py-1.5 font-mono text-[0.6875rem] text-foreground/85">
          {t('chat.tool.grep.matchesCount', { count: result.count })}
        </p>
      </div>
    )
  }

  if (result.mode === 'files') {
    if (result.files.length === 0)
      return <ToolEmptyState className="m-2.5" message={t('chat.tool.grep.noMatches')} />
    return (
      <ToolScrollPanel flush tone="subtle" maxHeight={PANEL_HEIGHT_MD}>
        <GrepQueryMeta input={input} t={t} />
        <ul className="divide-y divide-border/8">
          {result.files.map((file, index) => (
            <li key={`${index}-${file}`} className="hover:bg-background/24">
              <FileLabel path={file} />
            </li>
          ))}
        </ul>
        {result.truncated && <TruncatedNote t={t} />}
      </ToolScrollPanel>
    )
  }

  if (result.matches.length === 0)
    return <ToolEmptyState className="m-2.5" message={t('chat.tool.grep.noMatches')} />
  const matcher = buildMatcher(context.input as GrepInput | undefined)
  const groups = groupByFile(result.matches)
  return (
    <ToolScrollPanel flush tone="subtle" maxHeight={PANEL_HEIGHT_MD}>
      <GrepQueryMeta input={input} t={t} />
      <div className="divide-y divide-border/8">
        {groups.map((group, gi) => (
          <div key={`${gi}-${group.file}`}>
            <div className="border-b border-border/8 bg-secondary/40">
              <FileLabel path={group.file} count={group.rows.length} />
            </div>
            <ul>
              {group.rows.map((m, index) => (
                <li
                  key={`${index}-${m.line}`}
                  className="flex gap-2 px-2.5 py-0.5 font-mono text-[0.6875rem] leading-[1.5] hover:bg-background/24"
                >
                  <span className="w-8 shrink-0 select-none text-right tabular-nums text-muted-foreground/70">
                    {m.line}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                    <MatchText text={m.text} matcher={matcher} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {result.truncated && <TruncatedNote t={t} />}
    </ToolScrollPanel>
  )
}

function TruncatedNote({ t }: { t: TFn }): React.JSX.Element {
  return (
    <p className="border-t border-border/10 px-2.5 py-1 text-[0.5625rem] text-muted-foreground">
      {t('chat.tool.grep.truncated')}
    </p>
  )
}

export const grepRenderer: ToolRenderer = {
  Header: GrepHeader,
  Output: GrepOutputComp,
  fullBleed: true
}
