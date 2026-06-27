import { useTranslation } from 'react-i18next'
import type { TanzoUIMessage } from '@shared/agent-message'
import { MessageTokenUsage, type TokenUsageEntry } from './message-token-usage'

export function FinishFooter({ message }: { message: TanzoUIMessage }): React.JSX.Element | null {
  const { t } = useTranslation()
  const steps = message.metadata?.steps
  const hasStepUsage = steps?.some((step) => step.usage) ?? false

  const stepTotals = steps?.reduce(
    (acc, step) => {
      const u = step.usage
      if (!u) return acc
      acc.input += u.inputTokens ?? 0
      acc.output += u.outputTokens ?? 0
      acc.reasoning += u.reasoningTokens ?? 0
      acc.cacheRead += u.cacheReadTokens ?? 0
      acc.cacheWrite += u.cacheWriteTokens ?? 0
      return acc
    },
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  )
  const usage = message.metadata?.usage
  const totals =
    hasStepUsage && stepTotals
      ? stepTotals
      : {
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          reasoning: usage?.reasoningTokens ?? 0,
          cacheRead: usage?.cacheReadTokens ?? 0,
          cacheWrite: usage?.cacheWriteTokens ?? 0
        }

  const entries: TokenUsageEntry[] = []
  if (totals.input > 0)
    entries.push({ label: t('chat.message.tokenUsage.in'), value: totals.input })
  if (totals.output > 0)
    entries.push({ label: t('chat.message.tokenUsage.out'), value: totals.output })
  if (totals.reasoning > 0)
    entries.push({ label: t('chat.message.tokenUsage.reason'), value: totals.reasoning })
  if (totals.cacheRead > 0)
    entries.push({ label: t('chat.message.tokenUsage.cacheRead'), value: totals.cacheRead })
  if (totals.cacheWrite > 0)
    entries.push({ label: t('chat.message.tokenUsage.cacheWrite'), value: totals.cacheWrite })

  return <MessageTokenUsage entries={entries} />
}
