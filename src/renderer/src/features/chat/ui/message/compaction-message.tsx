import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useChatUiStore } from '../../model/store'
import { useDisclosure } from '../../model/use-disclosure'
import { MessageTokenUsage } from './message-token-usage'
import { Response } from './response'
import type { TanzoDataParts } from '@shared/agent-message'

export type CompactionMessageProps = TanzoDataParts['compaction']

export function CompactionMessage({
  stage,
  auto,
  summary,
  summaryId,
  afterTokens,
  usage
}: CompactionMessageProps): React.JSX.Element {
  const { t } = useTranslation()
  const panelId = useId()
  const isComplete = stage === 'complete'
  const isFailed = stage === 'failed'
  const disclosureKey = `compaction:${summaryId ?? panelId}`
  const storedOpen = useChatUiStore((state) => state.disclosureById[disclosureKey])
  const [isOpen, setIsOpen] = useDisclosure(disclosureKey, false)
  const label = isComplete
    ? t('chat.message.compaction.compacted')
    : isFailed
      ? t('chat.message.compaction.failed')
      : t('chat.message.compaction.compacting')

  useEffect(() => {
    if (storedOpen !== undefined) return
    if (!summary || isComplete) return
    setIsOpen(true)
  }, [isComplete, setIsOpen, storedOpen, summary])

  return (
    <div className="my-6" role="separator" aria-label={label}>
      <div className="flex items-center gap-3">
        <div
          className="h-px flex-1 bg-gradient-to-l from-border to-transparent"
          aria-hidden="true"
        />
        <div className="inline-flex items-center gap-1.5">
          {summary ? (
            <Button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              variant="ghost"
              className={cn(
                'h-auto items-center gap-1.5 rounded-sm px-0 py-0 text-xs text-muted-foreground',
                'bg-transparent hover:bg-transparent active:bg-transparent',
                'aria-expanded:bg-transparent dark:hover:bg-transparent dark:aria-expanded:bg-transparent',
                'cursor-pointer transition-colors hover:text-foreground',
                'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              )}
            >
              {label}
              {auto && <span className="ml-0.5">({t('chat.message.compaction.autoTag')})</span>}
              <ChevronDown
                aria-hidden="true"
                className={cn('size-3.5 transition-transform', isOpen && 'rotate-180')}
              />
            </Button>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
                !isComplete && !isFailed && 'animate-pulse',
                isFailed && 'text-destructive'
              )}
              role={isFailed ? 'alert' : 'status'}
              aria-live={isComplete ? undefined : 'polite'}
            >
              {label}
              {auto && <span className="ml-0.5">({t('chat.message.compaction.autoTag')})</span>}
            </span>
          )}
          <MessageTokenUsage
            entries={compactionUsageEntries(usage, afterTokens, t)}
            className="ml-0"
          />
        </div>
        <div
          className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
          aria-hidden="true"
        />
      </div>
      {summary && (
        <div
          id={panelId}
          role="region"
          aria-label={t('chat.message.compaction.summary')}
          hidden={!isOpen}
          className="mx-auto mt-3 max-h-[min(24rem,60vh)] max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-4"
        >
          <Response content={summary} className="text-sm text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

function compactionUsageEntries(
  usage: CompactionMessageProps['usage'],
  afterTokens: number | undefined,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (usage) {
    return [
      { label: t('chat.message.tokenUsage.in'), value: usage.inputTokens ?? 0 },
      { label: t('chat.message.tokenUsage.out'), value: usage.outputTokens ?? 0 },
      { label: t('chat.message.tokenUsage.reason'), value: usage.reasoningTokens ?? 0 },
      { label: t('chat.message.tokenUsage.cacheRead'), value: usage.cacheReadTokens ?? 0 },
      { label: t('chat.message.tokenUsage.cacheWrite'), value: usage.cacheWriteTokens ?? 0 }
    ]
  }
  return typeof afterTokens === 'number'
    ? [{ label: t('chat.message.tokenUsage.in'), value: afterTokens }]
    : []
}
