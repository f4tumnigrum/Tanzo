import { useTranslation } from 'react-i18next'
import type { McpPrompt } from '@/common/contracts'
import {
  SERVER_CARD_BODY_CLASS,
  SERVER_CARD_CLASS,
  SERVER_ROW_CLASS as ROW_CLASS
} from './server-section-styles'

interface ServerPromptsListProps {
  prompts: readonly McpPrompt[]
}

export function ServerPromptsList({ prompts }: ServerPromptsListProps) {
  const { t } = useTranslation()

  if (prompts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-[0.6875rem] text-foreground/40">
          {t('mcp.server.detail.prompts.empty')}
        </p>
      </div>
    )
  }

  return (
    <div className={SERVER_CARD_CLASS}>
      <div className={SERVER_CARD_BODY_CLASS}>
        {prompts.map((prompt) => (
          <div key={prompt.name} className={ROW_CLASS}>
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-emerald-500/78" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 truncate font-mono text-[length:var(--code-font-size)] leading-5 font-medium tracking-[0.01em] text-foreground/82">
                  {prompt.name}
                </span>
                {prompt.arguments && prompt.arguments.length > 0 && (
                  <span className="inline-flex shrink-0 items-center rounded-[5px] border border-border/35 bg-muted/20 px-1.5 py-0.5 text-[0.5625rem] font-medium leading-none tracking-[0.02em] text-foreground/58">
                    {prompt.arguments.length}{' '}
                    {t('mcp.server.detail.prompts.arguments').toLowerCase()}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] leading-3.5 tracking-[0.01em] text-foreground/52">
                {prompt.description && (
                  <span className="min-w-0 truncate">{prompt.description}</span>
                )}
                {prompt.arguments && prompt.arguments.length > 0 && (
                  <span className="shrink-0">
                    {prompt.arguments.map((a) => (
                      <span key={a.name} className="mr-1.5">
                        <code className="rounded-[4px] bg-muted/25 px-1 py-0.5 font-mono text-[length:var(--code-font-size-xs)] text-foreground/62">
                          {a.name}
                        </code>
                        <span className="ml-0.5 text-[0.5625rem] text-foreground/35">
                          {a.required
                            ? t('mcp.server.detail.prompts.required')
                            : t('mcp.server.detail.prompts.optional')}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
