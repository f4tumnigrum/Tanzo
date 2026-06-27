import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useDisclosure } from '../../model/use-disclosure'
import {
  buildToolRenderContext,
  isPendingState,
  type ToolRenderContext,
  type ToolStaticMeta
} from './render-context'
import {
  ShimmerText,
  ToolBody,
  ToolErrorState,
  ToolHeaderRow,
  ToolValuePreview
} from './primitives'
import { resolveToolRenderer } from './registry'
import type { UIMessagePart } from 'ai'

export interface ToolMessageBlockProps {
  part: UIMessagePart<never, never>
  metaByName?: Record<string, ToolStaticMeta>
  className?: string
}

export const ToolMessageBlock = memo(function ToolMessageBlock({
  part,
  metaByName,
  className
}: ToolMessageBlockProps): React.JSX.Element | null {
  const ctx = useMemo(
    () => buildToolRenderContext({ part, ...(metaByName ? { metaByName } : {}) }),
    [part, metaByName]
  )

  const disclosureKey = `tool:${ctx?.toolCallId ?? ''}`
  const [open, setDisclosureOpen, hasStoredOpen] = useDisclosure(disclosureKey, false)
  const autoOpenedRef = useRef(false)
  const userInteractedRef = useRef(false)
  const shouldAutoOpen =
    (ctx?.shortName === 'shell' &&
      (ctx.preliminary === true ||
        ctx.state === 'input-streaming' ||
        ctx.state === 'input-available')) ||
    (ctx?.shortName === 'askQuestion' && isPendingState(ctx.state))
  const shouldAutoClose = isSuccessfulShellCompletion(ctx)

  const setUserOpen = useCallback(
    (next: boolean) => {
      userInteractedRef.current = true
      setDisclosureOpen(next)
    },
    [setDisclosureOpen]
  )

  useEffect(() => {
    if (!shouldAutoOpen || hasStoredOpen || userInteractedRef.current) return
    autoOpenedRef.current = true
    setDisclosureOpen(true)
  }, [hasStoredOpen, setDisclosureOpen, shouldAutoOpen])

  useEffect(() => {
    if (!shouldAutoClose || !autoOpenedRef.current || userInteractedRef.current) return
    autoOpenedRef.current = false
    setDisclosureOpen(false)
  }, [setDisclosureOpen, shouldAutoClose])

  if (!ctx) return null

  const renderer = resolveToolRenderer(ctx)
  const HeaderComp = renderer?.Header ?? DefaultHeader
  const OutputComp = renderer?.Output ?? DefaultOutput
  const FooterComp = renderer?.Footer

  const showStreamingInput = ctx.state === 'input-streaming' && ctx.input !== undefined

  const renderOutput =
    ctx.errorText !== undefined ||
    ctx.output !== undefined ||
    Boolean(renderer?.renderWhenPending) ||
    !isPendingState(ctx.state)

  return (
    <Collapsible
      open={open}
      onOpenChange={setUserOpen}
      className={cn(
        'group not-prose overflow-hidden rounded-[var(--radius-xl)] border border-border/15 bg-card/85 shadow-sm backdrop-blur-sm',
        className
      )}
    >
      <HeaderComp context={ctx} />
      {open ? (
        <CollapsibleContent className="text-popover-foreground outline-none data-[panel-open]:border-t data-[panel-open]:border-border/10">
          {showStreamingInput && !renderer?.renderWhenPending ? (
            <ToolBody>
              <StreamingInputPreview input={ctx.input} />
            </ToolBody>
          ) : renderOutput ? (
            renderer?.fullBleed ? (
              <>
                <OutputComp context={ctx} />
                {FooterComp && (
                  <ToolBody className="pt-1.5">
                    <FooterComp context={ctx} />
                  </ToolBody>
                )}
              </>
            ) : (
              <ToolBody className="space-y-1.5">
                <OutputComp context={ctx} />
                {FooterComp && <FooterComp context={ctx} />}
              </ToolBody>
            )
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
})

function DefaultHeader({ context }: { context: ToolRenderContext }): React.JSX.Element {
  const titleish = pickInputDescriptor(context.input)
  return (
    <ToolHeaderRow
      icon={Wrench}
      label={context.shortName}
      {...(titleish ? { title: titleish } : {})}
      state={context.state}
      labelClassName="font-mono text-[0.6875rem] text-foreground/64"
    />
  )
}

function DefaultOutput({ context }: { context: ToolRenderContext }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (context.state === 'output-error' || context.errorText) {
    return <ToolErrorState message={context.errorText ?? t('chat.tool.common.error')} />
  }
  if (context.output === undefined) return null

  return <ToolValuePreview value={context.output} />
}

function StreamingInputPreview({ input }: { input: unknown }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-1 text-[0.5625rem] uppercase tracking-[0.08em] text-muted-foreground/70">
        <ShimmerText
          text={t('chat.tool.common.decodingInput')}
          className="text-[0.5625rem] tracking-[0.08em]"
        />
      </div>
      <ToolValuePreview value={input} maxHeight="160px" maxItems={6} maxTextLength={180} />
    </div>
  )
}

function pickInputDescriptor(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  for (const key of ['path', 'pattern', 'cmd', 'command', 'prompt', 'skill', 'title']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function isSuccessfulShellCompletion(ctx: ToolRenderContext | null): boolean {
  if (!ctx || ctx.shortName !== 'shell' || ctx.state !== 'output-available' || ctx.errorText) {
    return false
  }

  const output = ctx.output
  if (typeof output !== 'object' || output === null) return true

  const record = output as Record<string, unknown>
  if (
    record.reason === 'error' ||
    record.reason === 'timeout' ||
    record.reason === 'abort' ||
    record.reason === 'closed'
  ) {
    return false
  }
  if (record.status === 'running' || record.status === 'failed' || record.status === 'stopped') {
    return false
  }
  if (record.status === 'exited') return record.exitCode === 0
  if (Array.isArray(record.sessions) || record.stopped === true) return false

  if (typeof record.code === 'number') return record.code === 0
  if (typeof record.exitCode === 'number') return record.exitCode === 0

  return true
}
