import { useState } from 'react'
import { Braces, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { McpTool } from '@/common/contracts'
import {
  SERVER_CARD_BODY_CLASS,
  SERVER_CARD_CLASS,
  SERVER_ROW_CLASS as ROW_CLASS
} from './server-section-styles'

interface ServerToolsListProps {
  tools: readonly McpTool[]
}

export function ServerToolsList({ tools }: ServerToolsListProps) {
  const { t } = useTranslation()

  if (tools.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-[0.6875rem] text-foreground/40">
          {t('mcp.server.detail.tools.empty')}
        </p>
      </div>
    )
  }

  return (
    <div className={SERVER_CARD_CLASS}>
      <div className={SERVER_CARD_BODY_CLASS}>
        {tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  )
}

function ToolRow({ tool }: { tool: McpTool }) {
  const { t } = useTranslation()
  const [schemaOpen, setSchemaOpen] = useState(false)
  const hasSchema = tool.inputSchema.properties != null
  const paramCount = tool.inputSchema.properties
    ? Object.keys(tool.inputSchema.properties).length
    : 0

  return (
    <div>
      <div className={ROW_CLASS}>
        <span className={cn('mt-0.5 size-1.5 shrink-0 rounded-full', 'bg-emerald-500/78')} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 truncate font-mono text-[length:var(--code-font-size)] leading-5 font-medium tracking-[0.01em] text-foreground/82">
              {tool.name}
            </span>
          </div>
          {tool.description ? (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] leading-3.5 tracking-[0.01em] text-foreground/52">
              <span className="min-w-0 truncate">{tool.description}</span>
            </div>
          ) : null}
        </div>
        {hasSchema && (
          <button
            type="button"
            onClick={() => setSchemaOpen(!schemaOpen)}
            className={cn(
              'ml-auto flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 py-1',
              'text-[0.6875rem] tracking-[0.01em] transition-colors',
              'text-foreground/52 hover:text-foreground/82 hover:bg-muted/15',
              'opacity-0 group-hover:opacity-100',
              schemaOpen && 'opacity-100 text-foreground/72'
            )}
          >
            <Braces className="size-3" />
            <span>{t('mcp.server.detail.tools.schema')}</span>
            {paramCount > 0 && (
              <span className="text-[0.5625rem] text-foreground/35">{paramCount}</span>
            )}
            <ChevronDown
              className={cn(
                'size-2.5 text-foreground/35 transition-transform duration-200',
                schemaOpen && 'rotate-180'
              )}
            />
          </button>
        )}
      </div>
      {schemaOpen && tool.inputSchema && (
        <div className="px-3 pb-2.5">
          <pre className="ml-5 overflow-x-auto rounded-md bg-muted/20 p-2 font-mono text-[length:var(--code-font-size-xs)] leading-4 text-foreground/62">
            {JSON.stringify(tool.inputSchema, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
