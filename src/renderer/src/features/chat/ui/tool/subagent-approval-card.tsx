import { useState, useTransition } from 'react'
import { Check, ShieldAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  SubagentTaskApprovalResponse,
  SubagentTaskApprovalScope,
  SubagentTaskApprovalView
} from '@shared/subagent-task'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ShimmerText, ToolBody, ToolPanel } from './primitives'

export interface SubagentApprovalCardProps {
  approval: SubagentTaskApprovalView
  onRespond: (decision: SubagentTaskApprovalResponse) => Promise<void>
}

const SCOPE_OPTIONS: SubagentTaskApprovalScope[] = ['once', 'session', 'forever']
const DENY_SUGGESTIONS: Array<{ kind: 'retry' | 'amend' | 'skip' | 'abort' }> = [
  { kind: 'retry' },
  { kind: 'amend' },
  { kind: 'skip' },
  { kind: 'abort' }
]

export function SubagentApprovalCard({
  approval,
  onRespond
}: SubagentApprovalCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<SubagentTaskApprovalScope>('once')
  const [suggestion, setSuggestion] = useState<'retry' | 'amend' | 'skip' | 'abort' | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function respond(approved: boolean): void {
    setError(null)
    startTransition(async () => {
      try {
        const trimmed = reason.trim()
        await onRespond({
          approvalId: approval.approval.approvalId,
          approved,
          ...(trimmed ? { reason: trimmed } : {}),
          ...(scope !== 'once' ? { scope } : {}),
          ...(!approved && suggestion ? { suggestion: { kind: suggestion } } : {})
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const inputSummary = summarizeInput(approval.approval.input)
  const tools = approval.allowedTools

  return (
    <ToolBody>
      <ToolPanel tone="warning">
        <div className="space-y-2 px-2.5 py-2">
          <header className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-300">
            <ShieldAlert className="size-3 shrink-0" />
            <ShimmerText
              text={t('chat.subagentApproval.title', {
                agent: approval.agentType || 'subagent',
                tool: approval.approval.toolName
              })}
              className="text-[0.6875rem]"
            />
          </header>

          <p className="text-[0.625rem] leading-[1.45] text-foreground/70">
            <span className="font-medium text-foreground/85">
              {t('chat.subagentApproval.objective')}:
            </span>{' '}
            {approval.objective}
          </p>

          <p className="text-[0.625rem] text-foreground/55">
            {t('chat.subagentApproval.run')}: {approval.taskId}
          </p>

          {approval.phase ? (
            <p className="text-[0.625rem] text-foreground/55">
              {t('chat.subagentApproval.phase')}: {approval.phase}
            </p>
          ) : null}

          <p className="text-[0.625rem] text-foreground/55">
            {t('chat.subagentApproval.capabilities')}:{' '}
            {tools === null ? t('chat.subagentApproval.allTools') : tools.join(', ') || '—'}
          </p>

          {inputSummary ? (
            <p className="rounded-md bg-background/40 px-2 py-1 font-mono text-[length:var(--code-font-size-sm)] leading-[1.45] text-foreground/82">
              {inputSummary}
            </p>
          ) : null}

          <Textarea
            variant="bare"
            placeholder={t('chat.approval.reasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            disabled={pending}
            className="min-h-[2rem] rounded-md border border-border/15 bg-background/35 px-2 py-1 text-[0.6875rem]"
          />

          <div className="flex flex-wrap items-center gap-0.5">
            {DENY_SUGGESTIONS.map((option) => (
              <button
                key={option.kind}
                type="button"
                disabled={pending}
                onClick={() =>
                  setSuggestion((current) => (current === option.kind ? null : option.kind))
                }
                className={
                  suggestion === option.kind
                    ? 'rounded bg-foreground/10 px-2 py-0.5 text-[0.5625rem] font-medium text-foreground'
                    : 'rounded px-2 py-0.5 text-[0.5625rem] font-medium text-foreground/45 hover:text-foreground/80'
                }
              >
                {t(`chat.subagentApproval.suggestion.${option.kind}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5 rounded-md bg-background/40 p-0.5">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={pending}
                  onClick={() => setScope(option)}
                  className={
                    scope === option
                      ? 'rounded bg-foreground/10 px-2 py-0.5 text-[0.625rem] font-medium text-foreground'
                      : 'rounded px-2 py-0.5 text-[0.625rem] font-medium text-foreground/55 hover:text-foreground/85'
                  }
                >
                  {t(`chat.approval.scope.${option}`)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => respond(false)}
                className="h-6 gap-1 text-[0.6875rem] text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
              >
                <X className="size-3" />
                {t('chat.approval.deny')}
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => respond(true)}
                className="h-6 gap-1 bg-emerald-600 text-[0.6875rem] text-white hover:bg-emerald-700"
              >
                <Check className="size-3" />
                {t('chat.approval.approve')}
              </Button>
            </div>
          </div>

          {error ? <p className="text-[0.625rem] text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      </ToolPanel>
    </ToolBody>
  )
}

function summarizeInput(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') return clip(input)
  if (typeof input !== 'object') return clip(String(input))
  const record = input as Record<string, unknown>
  for (const key of ['cmd', 'command', 'path', 'pattern', 'objective', 'prompt']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return `${key}: ${clip(value)}`
  }
  try {
    return clip(JSON.stringify(input))
  } catch {
    return null
  }
}

function clip(s: string): string {
  return s.length > 240 ? s.slice(0, 240) + '…' : s
}
