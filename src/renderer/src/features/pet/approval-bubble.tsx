import { useState, useTransition } from 'react'
import { Check, ShieldAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SubagentApprovalScope } from '@shared/chat'
import type { PetApprovalRef } from '@shared/pet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ShimmerText, ToolBody, ToolPanel } from '@/features/chat/ui/tool/primitives'

interface ApprovalBubbleProps {
  approval: PetApprovalRef
  onRespond: (decision: {
    approved: boolean
    reason?: string
    scope?: SubagentApprovalScope
  }) => void
}

const SCOPE_OPTIONS: SubagentApprovalScope[] = ['once', 'session', 'forever']

export function ApprovalBubble({ approval, onRespond }: ApprovalBubbleProps): React.JSX.Element {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<SubagentApprovalScope>('once')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function respond(approved: boolean): void {
    setError(null)
    startTransition(async () => {
      try {
        const trimmed = reason.trim()
        onRespond({
          approved,
          ...(trimmed ? { reason: trimmed } : {}),
          ...(scope !== 'once' ? { scope } : {})
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <div className="not-prose w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-xl)] border border-border/60 bg-card shadow-lg">
      <ToolBody className="p-0">
        <ToolPanel tone="warning">
          <div className="space-y-2 px-2.5 py-2">
            <header className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-300">
              <ShieldAlert className="size-3 shrink-0" />
              <ShimmerText text={t('pet.approval.title')} className="text-[0.6875rem]" />
            </header>

            <p className="rounded-md bg-background/40 px-2 py-1 font-mono text-[length:var(--code-font-size-sm)] leading-[1.45] text-foreground/82">
              {approval.toolName}
            </p>

            <Textarea
              variant="bare"
              placeholder={t('chat.approval.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              disabled={pending}
              className="min-h-[2rem] rounded-md border border-border/15 bg-background/35 px-2 py-1 text-[0.6875rem]"
            />

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

            {error ? (
              <p className="text-[0.625rem] text-red-600 dark:text-red-400">{error}</p>
            ) : null}
          </div>
        </ToolPanel>
      </ToolBody>
    </div>
  )
}
