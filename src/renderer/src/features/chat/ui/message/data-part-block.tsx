import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TanzoDataParts } from '@shared/agent-message'
import type { ChangePreviewData } from '@shared/change-set'
import { ChangePreview } from '@/features/git/ui/change-preview'
import { CompactionMessage } from './compaction-message'

export type DataPartLike =
  | { type: 'data-plan'; data: TanzoDataParts['plan'] }
  | { type: 'data-fileDiff'; data: TanzoDataParts['fileDiff'] }
  | { type: 'data-changePreview'; data: TanzoDataParts['changePreview'] }
  | { type: 'data-status'; data: TanzoDataParts['status'] }
  | { type: 'data-compaction'; data: TanzoDataParts['compaction'] }

function ChangePreviewPart({ data }: { data: ChangePreviewData }): React.JSX.Element {
  const [preview, setPreview] = useState(data)
  return <ChangePreview preview={preview} onApplied={setPreview} />
}

export function DataPartBlock({ part }: { part: DataPartLike }): React.JSX.Element | null {
  const { t } = useTranslation()

  if (part.type === 'data-changePreview') {
    return <ChangePreviewPart data={part.data} />
  }

  if (part.type === 'data-status') {
    return <div className="text-[0.6875rem] italic text-muted-foreground/70">{part.data.label}</div>
  }

  if (part.type === 'data-plan') {
    return (
      <div className="rounded-md border border-border/20 bg-card/30 px-3 py-2">
        <div className="mb-1.5 text-[0.6875rem] font-medium text-foreground/70">
          {t('chat.message.parts.plan.title')}
        </div>
        <ol className="space-y-1">
          {part.data.steps.map((step, index) => (
            <li key={`${step.title}-${index}`} className="flex items-center gap-2 text-[0.75rem]">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/45" />
              <span className="min-w-0 flex-1 truncate text-foreground/85">{step.title}</span>
              <span className="text-[0.625rem] text-muted-foreground/70">
                {t(`chat.message.parts.plan.status.${step.status}`)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  if (part.type === 'data-fileDiff') {
    return (
      <div className="overflow-hidden rounded-md border border-border/20 bg-card/30">
        <div className="border-b border-border/15 px-3 py-1.5 font-mono text-[length:var(--code-font-size)] text-foreground/80">
          {part.data.path}
        </div>
        <div className="grid gap-px bg-border/10 sm:grid-cols-2">
          <pre className="max-h-56 overflow-auto bg-red-500/[0.04] p-2.5 text-[length:var(--code-font-size-sm)] leading-[1.45] whitespace-pre-wrap text-red-700 dark:text-red-300">
            {part.data.before}
          </pre>
          <pre className="max-h-56 overflow-auto bg-emerald-500/[0.05] p-2.5 text-[0.625rem] leading-[1.45] whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">
            {part.data.after}
          </pre>
        </div>
      </div>
    )
  }

  if (part.type === 'data-compaction') {
    return <CompactionMessage {...part.data} />
  }

  return null
}
