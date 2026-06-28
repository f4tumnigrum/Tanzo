import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, CheckCircle2, FileJson, RefreshCw, Search, Upload } from 'lucide-react'
import type { CodexImportPreview, CodexImportSessionSummary } from '@shared/codex-import'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { codexImportClient } from '@/platform/electron/codex-import-client'
import { chatKeys } from '@/features/chat/model/query-keys'
import { SectionCard } from './shared/settings-primitives'

const codexImportKeys = {
  scan: ['codex-import', 'scan'] as const,
  preview: (path: string | null) => ['codex-import', 'preview', path] as const
}

function formatDate(value: number): string {
  if (!value) return 'Unknown time'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsCodexImportTab(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [includeToolSummaries, setIncludeToolSummaries] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const scan = useQuery({
    queryKey: codexImportKeys.scan,
    queryFn: () => codexImportClient.scanDefault(),
    enabled: false
  })

  const preview = useQuery({
    queryKey: codexImportKeys.preview(previewPath),
    queryFn: () => codexImportClient.previewSession(previewPath!),
    enabled: Boolean(previewPath)
  })

  const importMutation = useMutation({
    mutationFn: (paths: string[]) =>
      codexImportClient.importSessions({
        sessionPaths: paths,
        options: {
          includeToolSummaries,
          contextTailMessages: 12,
          duplicateMode: 'skip'
        }
      }),
    onSuccess: () => {
      setSelectedPaths(new Set())
      void queryClient.invalidateQueries({ queryKey: codexImportKeys.scan })
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations() })
    }
  })

  const sessions = scan.data?.sessions ?? []
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(needle) ||
        session.relativePath.toLowerCase().includes(needle) ||
        session.sessionId.toLowerCase().includes(needle)
    )
  }, [query, sessions])

  const importableSelected = [...selectedPaths].filter((path) => {
    const session = sessions.find((item) => item.sourcePath === path)
    return session && !session.importedConversationId
  })

  function toggleSession(session: CodexImportSessionSummary): void {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(session.sourcePath)) next.delete(session.sourcePath)
      else next.add(session.sourcePath)
      return next
    })
  }

  function selectVisibleImportable(): void {
    setSelectedPaths(new Set(filtered.filter((session) => !session.importedConversationId).map((s) => s.sourcePath)))
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <SectionCard
        icon={<ArchiveRestore className="size-3.5" />}
        title="导入 Codex 历史"
        description="把本机 Codex JSONL 会话导入为可阅读、可继续对话的 Tanzo 会话。"
        action={
          <Button size="sm" onClick={() => scan.refetch()} disabled={scan.isFetching}>
            {scan.isFetching ? <Spinner className="mr-1.5 size-3.5" /> : <RefreshCw className="mr-1.5 size-3.5" />}
            扫描
          </Button>
        }
      >
        <div className="space-y-3 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="按标题、会话 ID 或路径筛选"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={selectVisibleImportable} disabled={filtered.length === 0}>
              选择可导入项
            </Button>
            <label className="flex shrink-0 items-center gap-2 rounded-md border border-border/10 px-2.5 py-1.5 text-xs text-foreground/75">
              <Checkbox
                checked={includeToolSummaries}
                onCheckedChange={(checked) => setIncludeToolSummaries(checked === true)}
              />
              包含工具记录
            </label>
            <Button
              type="button"
              size="sm"
              disabled={importableSelected.length === 0 || importMutation.isPending}
              onClick={() => importMutation.mutate(importableSelected)}
            >
              {importMutation.isPending ? <Spinner className="mr-1.5 size-3.5" /> : <Upload className="mr-1.5 size-3.5" />}
              导入 {importableSelected.length || ''}
            </Button>
          </div>

          {scan.data ? (
            <div className="flex flex-wrap gap-1.5 text-[0.6875rem] text-muted-foreground">
              <Badge variant="secondary">{scan.data.sessions.length} 个会话</Badge>
              <Badge variant="secondary">{scan.data.indexEntries} 条索引</Badge>
              <Badge variant="secondary">已扫描 {scan.data.filesScanned} 个文件</Badge>
              <span className="min-w-0 truncate">{scan.data.rootPath}</span>
            </div>
          ) : null}

          {scan.error ? <StatusText tone="error" text={scan.error instanceof Error ? scan.error.message : String(scan.error)} /> : null}
          {importMutation.data ? (
            <StatusText
              tone="success"
              text={`已导入 ${importMutation.data.imported} 个，跳过 ${importMutation.data.skipped} 个，失败 ${importMutation.data.failed} 个。`}
            />
          ) : null}
          {importMutation.error ? (
            <StatusText tone="error" text={importMutation.error instanceof Error ? importMutation.error.message : String(importMutation.error)} />
          ) : null}
        </div>
      </SectionCard>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/70">
          <div className="border-b border-border/10 px-3 py-2 text-xs font-medium text-foreground/80">
            会话列表
          </div>
          <div className="max-h-[560px] divide-y divide-border/10 overflow-y-auto">
            {filtered.map((session) => (
              <SessionRow
                key={session.sourcePath}
                session={session}
                selected={selectedPaths.has(session.sourcePath)}
                active={previewPath === session.sourcePath}
                onToggle={() => toggleSession(session)}
                onPreview={() => setPreviewPath(session.sourcePath)}
              />
            ))}
            {scan.isFetching ? <EmptyRow text="正在扫描 Codex 历史..." /> : null}
            {!scan.isFetching && scan.data && filtered.length === 0 ? <EmptyRow text="没有匹配的会话。" /> : null}
            {!scan.data && !scan.isFetching ? <EmptyRow text="先扫描本机 Codex 历史。" /> : null}
          </div>
        </section>

        <PreviewPanel preview={preview.data ?? null} loading={preview.isFetching} error={preview.error} />
      </div>
    </div>
  )
}

function SessionRow({
  session,
  selected,
  active,
  onToggle,
  onPreview
}: {
  session: CodexImportSessionSummary
  selected: boolean
  active: boolean
  onToggle: () => void
  onPreview: () => void
}) {
  const imported = Boolean(session.importedConversationId)
  return (
    <div className={cn('flex gap-2 px-3 py-2.5 transition-colors', active && 'bg-primary/5')}>
      <Checkbox checked={selected} onCheckedChange={onToggle} disabled={imported} className="mt-1" />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onPreview}>
        <div className="flex min-w-0 items-center gap-2">
          <FileJson className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground/88">{session.title}</span>
          {imported ? (
            <Badge variant="secondary" className="shrink-0 gap-1 text-[0.625rem]">
              <CheckCircle2 className="size-3" /> 已导入
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
          <span>{formatDate(session.updatedAt)}</span>
          <span>{formatBytes(session.bytes)}</span>
          <span className="min-w-0 truncate">{session.relativePath}</span>
        </div>
      </button>
    </div>
  )
}

function PreviewPanel({
  preview,
  loading,
  error
}: {
  preview: CodexImportPreview | null
  loading: boolean
  error: unknown
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/70">
      <div className="border-b border-border/10 px-3 py-2 text-xs font-medium text-foreground/80">
        预览
      </div>
      <div className="max-h-[560px] space-y-3 overflow-y-auto p-3">
        {loading ? <StatusText tone="muted" text="正在加载预览..." /> : null}
        {error ? <StatusText tone="error" text={error instanceof Error ? error.message : String(error)} /> : null}
        {!loading && !preview ? <StatusText tone="muted" text="选择一个会话查看可导入内容。" /> : null}
        {preview ? (
          <>
            <div>
              <h3 className="truncate text-sm font-medium text-foreground/90">{preview.session.title}</h3>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">{preview.session.sessionId}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.6875rem]">
              <Metric label="消息" value={preview.messageCount} />
              <Metric label="工具调用" value={preview.toolCalls} />
              <Metric label="已跳过" value={preview.skippedRecords} />
              <Metric label="解析错误" value={preview.parseErrors} />
            </div>
            {preview.warnings.map((warning) => (
              <StatusText key={warning} tone="warning" text={warning} />
            ))}
            <div className="space-y-2">
              {preview.sample.map((item, index) => (
                <div key={`${item.timestamp}-${index}`} className="rounded-md border border-border/10 bg-background/35 p-2">
                  <div className="mb-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
                    {item.role} · {formatDate(item.timestamp)}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[0.75rem] leading-5 text-foreground/82">{item.text}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/10 bg-background/35 p-2">
      <div className="text-[0.625rem] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground/88">{value}</div>
    </div>
  )
}

function StatusText({ tone, text }: { tone: 'muted' | 'success' | 'warning' | 'error'; text: string }) {
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-2 text-[0.75rem]',
        tone === 'muted' && 'border-border/10 bg-background/35 text-muted-foreground',
        tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        tone === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        tone === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive'
      )}
    >
      {text}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-3 py-8 text-center text-xs text-muted-foreground">{text}</div>
}
