import { useState, useTransition } from 'react'
import {
  CheckCircle,
  ChevronRight,
  Clock3,
  FileText,
  Globe2,
  Hammer,
  KeyRound,
  ShieldQuestion,
  TerminalSquare,
  XCircle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  useChatActions,
  type ApprovalDecision,
  type ApprovalScope
} from '../../chat-actions-context'
import { useDisclosure } from '../../model/use-disclosure'
import type { ToolRenderContext } from './render-context'

export interface ApprovalGroupProps {
  contexts: ToolRenderContext[]
}

type PermissionChoice = 'once' | 'session' | 'forever' | 'deny'
type TargetKind = 'path' | 'command' | 'url' | 'value'

const CHOICES: PermissionChoice[] = ['once', 'session', 'forever', 'deny']

export function ApprovalGroup({ contexts }: ApprovalGroupProps): React.JSX.Element | null {
  const actions = useChatActions()
  const { t } = useTranslation()
  const [pending, startTransition] = useTransition()
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pendingContexts = contexts.filter(
    (ctx) =>
      ctx.state === 'approval-requested' &&
      ctx.approval?.id &&
      !(ctx.approval.isAutomatic && ctx.approval.approved !== false)
  )

  if (resolved || pendingContexts.length === 0) return null

  function respond(choice: PermissionChoice): void {
    if (!actions) return
    setError(null)
    const approved = choice !== 'deny'
    const scope = choice === 'deny' ? 'once' : (choice as ApprovalScope)
    const decisions: ApprovalDecision[] = pendingContexts.map((ctx) => ({
      approvalId: ctx.approval!.id,
      approved,
      ...(scope !== 'once'
        ? {
            saveAs: {
              scope: scope === 'session' ? ('session' as const) : ('forever' as const),
              matcher: { toolName: ctx.toolName }
            }
          }
        : {})
    }))
    startTransition(async () => {
      try {
        await actions.respondToApprovals(decisions)
        setResolved(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const multiple = pendingContexts.length > 1

  return (
    <div className="not-prose mb-2.5 overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/85 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/15 bg-muted/20 px-2.5 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-md bg-muted/35 ring-1 ring-inset ring-border/15">
          <ShieldQuestion className="size-3 text-primary" />
        </span>
        <div className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-foreground/92">
          {multiple
            ? t('chat.approval.bulk.count', { count: pendingContexts.length })
            : t('chat.approval.permissionTitle')}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] tabular-nums text-amber-600 dark:text-amber-400">
          <Clock3 className="size-3" />
          {t('chat.approval.pending')}
        </span>
      </div>

      <div className="divide-y divide-border/10">
        {pendingContexts.map((ctx) => (
          <ApprovalRow key={ctx.toolCallId} context={ctx} />
        ))}
      </div>

      {error ? (
        <p className="px-2.5 pt-1.5 text-[0.625rem] text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <div className="border-t border-border/15 bg-muted/20 px-2.5 py-1.5">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {CHOICES.map((choice) => (
            <Button
              key={choice}
              variant={
                choice === 'deny' ? 'destructive' : choice === 'once' ? 'default' : 'secondary'
              }
              size="sm"
              className={cn(
                'h-7 min-w-0 gap-1 px-1.5 text-[0.6875rem]',
                choice === 'once' && 'bg-emerald-600 text-white hover:bg-emerald-700'
              )}
              disabled={pending || !actions}
              onClick={() => respond(choice)}
            >
              {choiceIcon(choice)}
              <span className="min-w-0 truncate">{choiceLabel(choice, multiple, t)}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ApprovalRow({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useDisclosure(`approval:${context.toolCallId}`, false)
  const target = targetSummary(context.input, t)
  const detail = stringify(context.input)

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="px-2.5 py-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border/20 bg-background/70">
            {targetIcon(target?.kind)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-[0.8125rem] font-medium text-foreground/92">
                {context.shortName}
              </span>
            </div>
            {target ? (
              <div className="mt-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-1.5 text-[0.75rem]">
                <span className="shrink-0 text-muted-foreground">{target.label}</span>
                <span className="min-w-0 break-all font-mono text-foreground/68">
                  {target.value}
                </span>
              </div>
            ) : null}
          </div>
          {detail ? (
            <CollapsibleTrigger
              render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" />}
            >
              <ChevronRight
                className={cn('size-3 transition-transform', expanded && 'rotate-90')}
              />
            </CollapsibleTrigger>
          ) : null}
        </div>

        {detail ? (
          <CollapsibleContent>
            <pre className="mt-1.5 max-h-44 overflow-auto rounded-md border border-border/15 bg-secondary/20 px-2.5 py-2 font-mono text-[length:var(--code-font-size)] leading-relaxed break-words whitespace-pre-wrap text-foreground/78">
              {detail}
            </pre>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  )
}

function choiceLabel(
  choice: PermissionChoice,
  multiple: boolean,
  t: (key: string) => string
): string {
  if (choice === 'deny') return multiple ? t('chat.approval.bulk.denyAll') : t('chat.approval.deny')
  if (choice === 'once' && multiple) return t('chat.approval.bulk.approveAll')
  return t(`chat.approval.scope.${choice}`)
}

function choiceIcon(choice: PermissionChoice): React.JSX.Element {
  if (choice === 'deny') return <XCircle className="size-3" />
  if (choice === 'once') return <CheckCircle className="size-3" />
  return <KeyRound className="size-3" />
}

interface TargetSummary {
  label: string
  value: string
  kind: TargetKind
}

function targetSummary(input: unknown, t: (key: string) => string): TargetSummary | null {
  if (input === null || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const command = stringArg(record, ['cmd', 'command'])
  if (command) return { label: t('chat.approval.target.command'), value: command, kind: 'command' }
  const path = stringArg(record, ['path', 'file', 'filePath'])
  if (path) return { label: t('chat.approval.target.path'), value: path, kind: 'path' }
  const url = stringArg(record, ['url', 'uri', 'endpoint'])
  if (url) return { label: t('chat.approval.target.url'), value: url, kind: 'url' }
  const value = stringArg(record, ['pattern', 'prompt', 'query'])
  if (value) return { label: t('chat.approval.target.value'), value, kind: 'value' }
  return null
}

function targetIcon(kind: TargetKind | undefined): React.JSX.Element {
  const className = 'size-3.5 text-muted-foreground'
  switch (kind) {
    case 'path':
      return <FileText className={className} />
    case 'command':
      return <TerminalSquare className={className} />
    case 'url':
      return <Globe2 className={className} />
    default:
      return <Hammer className={className} />
  }
}

function stringArg(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function stringify(input: unknown): string | null {
  if (input === undefined || input === null) return null
  if (typeof input === 'string') return input
  try {
    const text = JSON.stringify(input, null, 2)
    return text.length > 3000 ? text.slice(0, 3000) + '…' : text
  } catch {
    return null
  }
}
