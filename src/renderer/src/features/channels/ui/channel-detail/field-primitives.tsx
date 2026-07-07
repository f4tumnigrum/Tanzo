import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { ChannelConnectionState } from '@shared/chat-bridge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ROW_STACK, HINT, FIELD_LABEL } from './field-tokens'

export function ChannelStatusBadge({
  state
}: {
  state: ChannelConnectionState
}): React.JSX.Element {
  const { t } = useTranslation()
  const map: Record<
    ChannelConnectionState,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    disabled: {
      label: t('channels.status.disabled', { defaultValue: 'Disabled' }),
      className: 'text-foreground/50 bg-muted/40',
      icon: <span className="size-1.5 rounded-full bg-foreground/40" />
    },
    connecting: {
      label: t('channels.status.connecting', { defaultValue: 'Connecting…' }),
      className: 'text-amber-600 bg-amber-500/10',
      icon: <Loader2 className="size-3 animate-spin" />
    },
    connected: {
      label: t('channels.status.connected', { defaultValue: 'Connected' }),
      className: 'text-emerald-600 bg-emerald-500/10',
      icon: <CheckCircle2 className="size-3" />
    },
    error: {
      label: t('channels.status.error', { defaultValue: 'Error' }),
      className: 'text-destructive bg-destructive/10',
      icon: <AlertCircle className="size-3" />
    }
  }
  const entry = map[state]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.625rem] font-medium tabular-nums',
        entry.className
      )}
    >
      {entry.icon}
      {entry.label}
    </span>
  )
}

/** A small segmented control matching the app's outline/default button pairing. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: { value: T }[]
  value: T
  onChange: (next: T) => void
  label: (value: T) => string
}): React.JSX.Element {
  return (
    <div className="inline-flex items-center gap-1">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="xs"
          variant={value === option.value ? 'default' : 'outline'}
          onClick={() => onChange(option.value)}
        >
          {label(option.value)}
        </Button>
      ))}
    </div>
  )
}

/** A text field with a label, laid out in a ROW_STACK. */
export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  password,
  hint
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  password?: boolean
  hint?: string
}): React.JSX.Element {
  return (
    <div className={ROW_STACK}>
      <label className={FIELD_LABEL}>{label}</label>
      <Input
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8"
        autoComplete="off"
      />
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  )
}

/** A chip-list editor for id allowlists. */
export function ChipListEditor({
  values,
  onChange,
  placeholder
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || values.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...values, trimmed])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-muted/45 px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-foreground/80 ring-1 ring-inset ring-border/15"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="text-foreground/40 transition-colors hover:text-destructive"
                aria-label={t('channels.safety.removeValue', {
                  defaultValue: 'Remove {{value}}',
                  value
                })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          className="h-8"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!draft.trim()}
          aria-label={t('channels.safety.addValue', { defaultValue: 'Add value' })}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

/** The write-only secret field with a "stored/not set" badge. */
export function SecretField({
  label,
  configured,
  draft,
  onDraftChange,
  onSave,
  onClear,
  saving,
  placeholder,
  hint
}: {
  label: string
  configured: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSave: () => void
  onClear: () => void
  saving: boolean
  placeholder?: string
  hint?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={ROW_STACK}>
      <div className="flex items-center gap-2">
        <label className={FIELD_LABEL}>{label}</label>
        <span
          className={cn(
            'rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.625rem] font-medium',
            configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted/50 text-foreground/45'
          )}
        >
          {configured
            ? t('channels.secret.stored', { defaultValue: 'stored' })
            : t('channels.secret.notSet', { defaultValue: 'not set' })}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={placeholder}
          className="h-8"
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={saving || draft.length === 0}
        >
          {t('channels.secret.save', { defaultValue: 'Save' })}
        </Button>
        {configured ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={saving}>
            {t('channels.secret.clear', { defaultValue: 'Clear' })}
          </Button>
        ) : null}
      </div>
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  )
}
