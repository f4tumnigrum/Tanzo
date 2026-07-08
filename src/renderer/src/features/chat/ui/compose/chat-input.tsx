import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileUIPart } from 'ai'
import { ArrowUp, CircleStop, Paperclip, ShieldAlert, ShieldQuestion, Skull } from 'lucide-react'
import type { SlashCommandDef } from '@shared/slash-command'
import type { PermissionMode } from '@shared/policy'
import { Button } from '@/components/ui/button'
import { LiquidGlass } from '@/components/ui/liquid-glass'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SlashCommandMenu } from './slash-command-menu'
import { useSlashMenu } from './use-slash-menu'
import { MentionMenu } from './mention-menu'
import { useMentionMenu, type PluginMentionOption } from './use-mention-menu'
import { useAttachments } from './use-attachments'
import { toolbarBaseButtonClass } from './surface-style'
import { ComposerAttachment } from './composer-attachment'

const MODE_ORDER: readonly PermissionMode[] = ['default', 'plan', 'yolo', 'dangerous']

interface ModeChrome {
  icon: typeof ShieldQuestion
  iconClass: string
}
const MODE_CHROME: Record<PermissionMode, ModeChrome> = {
  default: {
    icon: ShieldQuestion,
    iconClass: 'text-amber-500'
  },
  plan: {
    icon: ShieldQuestion,
    iconClass: 'text-violet-500'
  },
  yolo: {
    icon: ShieldAlert,
    iconClass: 'text-emerald-500'
  },
  dangerous: {
    icon: Skull,
    iconClass: 'text-red-500'
  }
}

export interface ChatInputState {
  isStreaming: boolean

  isStopping?: boolean
  permissionMode?: PermissionMode

  contextBadge?: React.ReactNode

  canSubmitOverride?: boolean

  toolbarHint?: React.ReactNode
}

export interface ChatInputActions {
  onSubmit?: (text: string, files?: FileUIPart[]) => void | Promise<void>
  onSteer?: (text: string) => void | Promise<void>
  onQueue?: (text: string) => void | Promise<void>
  onStop?: () => void
  onPermissionModeChange?: (mode: PermissionMode) => void
}

export interface ChatInputProps {
  state: ChatInputState
  actions: ChatInputActions

  middleSlot?: React.ReactNode

  trailingSlot?: React.ReactNode
  placeholder?: string
  className?: string

  slashCommands?: SlashCommandDef[]

  workspaceRoot?: string | null

  pluginMentions?: PluginMentionOption[]

  draft?: string
  onDraftChange?: (draft: string) => void
}

export function ChatInput({
  state,
  actions,
  middleSlot,
  trailingSlot,
  placeholder,
  className,
  slashCommands = [],
  workspaceRoot = null,
  pluginMentions,
  draft,
  onDraftChange
}: ChatInputProps): React.JSX.Element {
  const { t } = useTranslation()
  const {
    isStreaming,
    isStopping = false,
    permissionMode = 'default',
    contextBadge,
    canSubmitOverride,
    toolbarHint
  } = state
  const { onSubmit, onSteer, onQueue, onStop, onPermissionModeChange } = actions
  const [value, setValueState] = useState(draft ?? '')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isComposingRef = useRef(false)

  const setValue = useCallback(
    (next: string) => {
      setValueState(next)
      onDraftChange?.(next)
    },
    [onDraftChange]
  )

  const {
    attachments,
    isDragging,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleFileInputChange
  } = useAttachments(isStreaming)

  const {
    slashMenuOpen,
    slashMatches,
    slashHighlight,
    setSlashHighlight,
    selectSlashCommand,
    resetHighlightOnQueryChange,
    handleSlashKeyDown
  } = useSlashMenu({
    value,
    setValue,
    slashCommands,
    isStreaming,
    textareaRef,
    ...(onSubmit ? { onSubmit: (text: string) => onSubmit(text) } : {})
  })

  const {
    mentionMenuOpen,
    mentionItems,
    mentionHighlight,
    setMentionHighlight,
    selectMention,
    syncMention,
    handleMentionKeyDown,
    resetHighlightOnQueryChange: resetMentionHighlightOnQueryChange
  } = useMentionMenu({
    value,
    setValue,
    textareaRef,
    workspaceRoot,
    isStreaming,
    plugins: pluginMentions
  })

  const queueable = isStreaming && Boolean(onQueue)
  const steerable = isStreaming && Boolean(onSteer)
  const hasContent = value.trim().length > 0 || attachments.length > 0
  const canSubmit =
    hasContent &&
    (canSubmitOverride === undefined || canSubmitOverride) &&
    (!isStreaming || queueable || steerable)

  const dispatch = useCallback(
    async (intent: 'queue' | 'steer') => {
      if (!canSubmit) return
      const text = value
      if (isStreaming) {
        if (intent === 'steer' && steerable) {
          setValue('')
          await onSteer?.(text)
        } else if (queueable) {
          setValue('')
          await onQueue?.(text)
        } else if (steerable) {
          setValue('')
          await onSteer?.(text)
        }
        return
      }
      const files = attachments
      setValue('')
      clearAttachments()
      await onSubmit?.(text, files.length > 0 ? files : undefined)
    },
    [
      canSubmit,
      value,
      attachments,
      clearAttachments,
      isStreaming,
      queueable,
      steerable,
      onSubmit,
      onSteer,
      onQueue,
      setValue
    ]
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value
      setValue(nextValue)
      resetHighlightOnQueryChange(nextValue)
      resetMentionHighlightOnQueryChange(nextValue)
    },
    [resetHighlightOnQueryChange, resetMentionHighlightOnQueryChange, setValue]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const composing = isComposingRef.current || event.nativeEvent.isComposing
      if (handleSlashKeyDown(event, composing)) return
      if (handleMentionKeyDown(event, composing)) return
      if (
        event.key === 'Backspace' &&
        !composing &&
        attachments.length > 0 &&
        event.currentTarget.selectionStart === 0 &&
        event.currentTarget.selectionEnd === 0
      ) {
        event.preventDefault()
        removeAttachment(attachments.length - 1)
        return
      }
      if (event.key !== 'Enter' || event.shiftKey || composing) return
      if (event.metaKey || event.ctrlKey) {
        if (isStreaming) {
          event.preventDefault()
          void dispatch('steer')
        }
        return
      }
      event.preventDefault()
      void dispatch('queue')
    },
    [
      dispatch,
      handleSlashKeyDown,
      handleMentionKeyDown,
      isStreaming,
      attachments.length,
      removeAttachment
    ]
  )

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const [modeMenuOpen, setModeMenuOpen] = useState(false)

  useEffect(() => {
    if (!isStreaming || steerable) textareaRef.current?.focus()
  }, [isStreaming, steerable])

  return (
    <div
      className={cn('relative flex w-full flex-col', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      {slashMenuOpen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-30 flex flex-col items-center gap-0">
          <SlashCommandMenu
            commands={slashMatches}
            highlightedIndex={slashHighlight}
            isStreaming={isStreaming}
            onHighlight={setSlashHighlight}
            onSelect={(command) => void selectSlashCommand(command)}
            className="w-[calc(100%-0.75rem)] max-w-[440px]"
          />
        </div>
      ) : null}
      {!slashMenuOpen && mentionMenuOpen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-30 flex flex-col items-center gap-0">
          <MentionMenu
            items={mentionItems}
            highlightedIndex={mentionHighlight}
            onHighlight={setMentionHighlight}
            onSelect={selectMention}
            className="w-[calc(100%-0.75rem)] max-w-[440px]"
          />
        </div>
      ) : null}
      <LiquidGlass
        intensity={1.15}
        style={
          {
            '--glass-surface-blur': '6px',
            '--glass-surface-bg': 'color-mix(in oklab, var(--card) 56%, transparent)'
          } as React.CSSProperties
        }
        className={cn(
          'flex min-h-[114px] flex-col overflow-hidden',
          'rounded-[var(--radius-xl)] shadow-none!',
          'transition-shadow duration-200 ease-out',
          isDragging && 'ring-2 ring-ring/60'
        )}
      >
        {contextBadge ? <div className="absolute top-1.5 right-2 z-10">{contextBadge}</div> : null}

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((part, index) => (
              <ComposerAttachment
                key={`${part.filename ?? 'image'}-${index}`}
                part={part}
                onRemove={() => removeAttachment(index)}
                removeLabel={t('chat.composer.attachments.remove')}
                imageTitle={t('chat.composer.attachments.imageTitle')}
              />
            ))}
          </div>
        ) : null}

        <div className="scrollbar-none relative max-h-[160px] flex-1 overflow-y-auto">
          <Textarea
            ref={textareaRef}
            variant="bare"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={syncMention}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            placeholder={
              placeholder ??
              (steerable
                ? t('chat.composer.steeringPlaceholder')
                : t('chat.composer.defaultPlaceholder'))
            }
            rows={1}
            className="min-h-[36px] overflow-hidden px-4 py-3 text-base text-foreground"
          />
        </div>

        <div className="flex flex-wrap items-center gap-0.5 px-3 pb-1">
          <div className="mr-auto flex min-w-0 items-center">
            <div
              role="radiogroup"
              aria-label={t('chat.composer.permissionModeLabel')}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setModeMenuOpen(false)
                }
              }}
              className="inline-flex items-center gap-0.5 rounded-[var(--radius-lg)] p-0.5"
            >
              {(modeMenuOpen
                ? [permissionMode, ...MODE_ORDER.filter((mode) => mode !== permissionMode)]
                : [permissionMode]
              ).map((mode) => {
                const item = MODE_CHROME[mode]
                const ItemIcon = item.icon
                const active = mode === permissionMode
                const modeLabel = t(`chat.composer.permissionMode.${mode}.label`)
                const modeTooltip = t(`chat.composer.permissionMode.${mode}.tooltip`)
                return (
                  <Tooltip key={mode}>
                    <TooltipTrigger
                      render={(triggerProps) => (
                        <button
                          {...triggerProps}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={modeLabel}
                          disabled={isStreaming}
                          onClick={() => {
                            if (!modeMenuOpen) {
                              setModeMenuOpen(true)
                              return
                            }
                            onPermissionModeChange?.(mode)
                            setModeMenuOpen(false)
                          }}
                          className={cn(
                            'inline-flex h-5 items-center gap-1 rounded-[var(--radius-md)] px-1.5',
                            'text-[0.625rem] font-medium leading-none outline-none transition-colors duration-150',
                            'focus-visible:ring-1 focus-visible:ring-ring/60',
                            'disabled:cursor-not-allowed disabled:opacity-45',
                            !modeMenuOpen
                              ? 'text-foreground hover:text-foreground/85'
                              : active
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground/65 hover:text-foreground/85'
                          )}
                        >
                          <ItemIcon
                            className={cn(
                              'size-3 shrink-0',
                              (active || !modeMenuOpen) && item.iconClass
                            )}
                            strokeWidth={1.8}
                          />
                          <span>{modeLabel}</span>
                        </button>
                      )}
                    />
                    <TooltipContent side="top">{modeTooltip}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            {middleSlot}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-0.5">
            {toolbarHint ? (
              <span className="mr-1 truncate text-[0.625rem] text-muted-foreground/65">
                {toolbarHint}
              </span>
            ) : null}
            {trailingSlot}

            <div className="ml-0.5 inline-flex items-center gap-0.5 rounded-[var(--radius-4xl)] border border-[var(--compose-control-border)] bg-[var(--compose-control-bg)] p-0.5 shadow-xs">
              <Tooltip>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      type="button"
                      aria-label={
                        isStreaming
                          ? t('chat.composer.attachmentsStreamingDisabled')
                          : t('chat.composer.attachments.attach')
                      }
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isStreaming}
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        toolbarBaseButtonClass,
                        'bg-transparent shadow-none',
                        isStreaming && 'cursor-not-allowed opacity-45 hover:bg-transparent'
                      )}
                    >
                      <Paperclip className="size-3" strokeWidth={1.8} />
                    </Button>
                  )}
                />
                <TooltipContent side="top">
                  {isStreaming
                    ? t('chat.composer.attachmentsStreamingDisabled')
                    : t('chat.composer.attachments.attach')}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={(triggerProps) => (
                    <Button
                      {...triggerProps}
                      type="button"
                      onClick={isStreaming ? onStop : () => void dispatch('queue')}
                      disabled={isStreaming ? !onStop || isStopping : !canSubmit}
                      aria-label={
                        isStreaming
                          ? isStopping
                            ? t('chat.composer.stopping')
                            : t('chat.composer.stop')
                          : t('chat.composer.send')
                      }
                      size="icon-xs"
                      className={cn(
                        'size-6 rounded-[var(--radius-4xl)] p-0',
                        'transition-all duration-150 focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:outline-none',
                        isStreaming
                          ? 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/92 active:scale-[0.96] active:bg-destructive/85 disabled:pointer-events-none disabled:opacity-60'
                          : canSubmit
                            ? 'bg-foreground text-background shadow-xs hover:bg-foreground/92 active:scale-[0.96] active:bg-foreground/85'
                            : 'pointer-events-none bg-foreground/30 text-background/70 shadow-none'
                      )}
                    >
                      {isStreaming ? (
                        <CircleStop
                          className={cn('size-3.5', isStopping && 'animate-pulse')}
                          strokeWidth={1.85}
                        />
                      ) : (
                        <ArrowUp className="size-3.5" strokeWidth={2.15} />
                      )}
                    </Button>
                  )}
                />
                <TooltipContent side="top">
                  {isStreaming
                    ? isStopping
                      ? t('chat.composer.stopping')
                      : t('chat.composer.stop')
                    : t('chat.composer.sendShortcut')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </LiquidGlass>
    </div>
  )
}
