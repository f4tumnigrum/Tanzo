import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, RotateCcw, Save, Sliders, X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  ModelFamily,
  ProviderDefaultsState,
  ProviderId,
  ProviderOptionField
} from '@/common/contracts'
import { formatJsonObject, getPathValue, parseJsonObject, setPathValue } from '../../lib/json'
import { useProviderOptionSchemas, useSaveProviderDefaults } from '../../model'
import { FloatingSaveBar } from './floating-save-bar'
import { ProviderSectionCard } from './provider-section'
import {
  PROVIDER_CONTROL_CLASS as INPUT_CLASS,
  PROVIDER_FIELD_ROW_CLASS as SETTINGS_FIELD_ROW_CLASS,
  PROVIDER_LABEL_CLASS as LABEL_CLASS,
  PROVIDER_TEXTAREA_CLASS as TEXTAREA_CLASS
} from './provider-section-styles'

interface DefaultsPanelProps {
  providerId: ProviderId
  family: ModelFamily
  defaults: ProviderDefaultsState
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error'

interface DefaultsFormState {
  key: string
  callDefaultsText: string
  providerOptions: ProviderDefaultsState['providerOptions']
  rawProviderOptionsText: string
  invalidJsonFields: Record<string, boolean>
  resetToken: number
  error: string | null
  saveStatus: SaveStatus
}

export function DefaultsPanel({ providerId, family, defaults }: DefaultsPanelProps) {
  const { t } = useTranslation()
  const schemasQuery = useProviderOptionSchemas(providerId, family)
  const saveDefaults = useSaveProviderDefaults(providerId)
  const [resetOpen, setResetOpen] = useState(false)

  const baselineCallText = useMemo(
    () => formatJsonObject(defaults.callDefaults),
    [defaults.callDefaults]
  )
  const baselineRawText = useMemo(
    () => formatJsonObject(defaults.rawProviderOptions),
    [defaults.rawProviderOptions]
  )
  const baselineKey = useMemo(
    () => JSON.stringify([baselineCallText, defaults.providerOptions, baselineRawText]),
    [baselineCallText, baselineRawText, defaults.providerOptions]
  )

  const [formState, setFormState] = useState<DefaultsFormState>({
    key: baselineKey,
    callDefaultsText: baselineCallText,
    providerOptions: defaults.providerOptions,
    rawProviderOptionsText: baselineRawText,
    invalidJsonFields: {},
    resetToken: 0,
    error: null,
    saveStatus: 'idle'
  })

  const fields = useMemo(
    () => schemasQuery.data?.flatMap((schema) => schema.fields) ?? [],
    [schemasQuery.data]
  )
  const activeForm =
    formState.key === baselineKey
      ? formState
      : {
          key: baselineKey,
          callDefaultsText: baselineCallText,
          providerOptions: defaults.providerOptions,
          rawProviderOptionsText: baselineRawText,
          invalidJsonFields: {},
          resetToken: formState.resetToken,
          error: null,
          saveStatus: 'idle' as const
        }
  const {
    callDefaultsText,
    providerOptions,
    rawProviderOptionsText,
    invalidJsonFields,
    resetToken,
    error,
    saveStatus
  } = activeForm

  useEffect(() => {
    if (saveStatus !== 'success' && saveStatus !== 'error') return
    const timer = setTimeout(() => {
      setFormState((current) =>
        current.key === baselineKey ? { ...current, saveStatus: 'idle' } : current
      )
    }, 2200)
    return () => clearTimeout(timer)
  }, [baselineKey, saveStatus])

  const callChanged = callDefaultsText !== baselineCallText
  const rawChanged = rawProviderOptionsText !== baselineRawText
  const optionsChanged = useMemo(
    () => JSON.stringify(providerOptions) !== JSON.stringify(defaults.providerOptions),
    [defaults.providerOptions, providerOptions]
  )
  const invalidJsonCount = Object.keys(invalidJsonFields).length
  const hasInvalidJson = invalidJsonCount > 0
  const hasChanges = callChanged || rawChanged || optionsChanged || hasInvalidJson
  const changeCount =
    (callChanged ? 1 : 0) + (rawChanged ? 1 : 0) + (optionsChanged ? 1 : 0) + invalidJsonCount

  function formForUpdate(current: DefaultsFormState): DefaultsFormState {
    if (current.key === baselineKey) return current
    return {
      key: baselineKey,
      callDefaultsText: baselineCallText,
      providerOptions: defaults.providerOptions,
      rawProviderOptionsText: baselineRawText,
      invalidJsonFields: {},
      resetToken: current.resetToken,
      error: null,
      saveStatus: 'idle'
    }
  }

  function handleFieldChange(field: ProviderOptionField, value: unknown) {
    setFormState((current) => {
      const form = formForUpdate(current)
      return {
        ...form,
        providerOptions: setPathValue(form.providerOptions, field.path, value),
        error: null,
        saveStatus: 'idle'
      }
    })
  }

  function handleJsonInvalidChange(path: string, invalid: boolean) {
    setFormState((current) => {
      const form = formForUpdate(current)
      const isCurrentlyInvalid = Boolean(form.invalidJsonFields[path])
      if (isCurrentlyInvalid === invalid) return form
      const invalidJsonFields = { ...form.invalidJsonFields }
      if (invalid) {
        invalidJsonFields[path] = true
      } else {
        delete invalidJsonFields[path]
      }
      return {
        ...form,
        invalidJsonFields,
        error: invalid ? form.error : null,
        saveStatus: 'idle'
      }
    })
  }

  function handleSave() {
    if (!hasChanges) return
    if (hasInvalidJson) {
      setFormState({
        ...activeForm,
        error: t('providers.defaults.errors.objectRequired'),
        saveStatus: 'error'
      })
      return
    }
    try {
      setFormState({ ...activeForm, error: null, saveStatus: 'saving' })
      saveDefaults.mutate(
        {
          byFamily: {
            [family]: {
              callDefaults: parseJsonObject(callDefaultsText),
              providerOptions,
              rawProviderOptions: parseJsonObject(rawProviderOptionsText)
            }
          }
        },
        {
          onSuccess: () => setFormState({ ...activeForm, error: null, saveStatus: 'success' }),
          onError: () => setFormState({ ...activeForm, saveStatus: 'error' })
        }
      )
    } catch (err) {
      if (err instanceof Error && err.message === 'json.objectRequired') {
        setFormState({
          ...activeForm,
          error: t('providers.defaults.errors.objectRequired'),
          saveStatus: 'error'
        })
        return
      }
      setFormState({
        ...activeForm,
        error: err instanceof Error ? err.message : String(err),
        saveStatus: 'error'
      })
    }
  }

  function handleCancel() {
    setFormState((current) => ({
      key: baselineKey,
      callDefaultsText: baselineCallText,
      providerOptions: defaults.providerOptions,
      rawProviderOptionsText: baselineRawText,
      invalidJsonFields: {},
      resetToken: current.resetToken + 1,
      error: null,
      saveStatus: 'idle'
    }))
  }

  const hasSavedDefaults =
    baselineCallText.trim() !== '' ||
    baselineRawText.trim() !== '' ||
    Object.keys(defaults.providerOptions).length > 0

  function handleReset() {
    saveDefaults.mutate(
      {
        byFamily: {
          [family]: {
            callDefaults: {},
            providerOptions: {},
            rawProviderOptions: {}
          }
        }
      },
      {
        onSuccess: () => {
          setResetOpen(false)
          setFormState((current) => ({
            key: baselineKey,
            callDefaultsText: baselineCallText,
            providerOptions: defaults.providerOptions,
            rawProviderOptionsText: baselineRawText,
            invalidJsonFields: {},
            resetToken: current.resetToken + 1,
            error: null,
            saveStatus: 'idle'
          }))
        }
      }
    )
  }

  return (
    <div className="relative space-y-2">
      <ProviderSectionCard
        icon={Sliders}
        title={t('providers.defaults.title')}
        description={t('providers.defaults.description')}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setResetOpen(true)}
            disabled={!hasSavedDefaults || saveDefaults.isPending}
            className="h-7 gap-1.5 rounded-xl px-2.5 text-[0.6875rem]"
          >
            <RotateCcw className="size-3.5" />
            {t('providers.defaults.reset.button')}
          </Button>
        }
      >
        {fields.map((field) => (
          <OptionField
            key={field.path}
            field={field}
            value={getPathValue(providerOptions, field.path)}
            resetToken={resetToken}
            onChange={(value) => handleFieldChange(field, value)}
            onJsonInvalidChange={(invalid) => handleJsonInvalidChange(field.path, invalid)}
          />
        ))}

        <div className={SETTINGS_FIELD_ROW_CLASS}>
          <div className="min-w-0 space-y-1">
            <Label className={LABEL_CLASS}>{t('providers.defaults.callDefaults.label')}</Label>
            <p className="text-[0.625rem] leading-4 text-muted-foreground">
              {t('providers.defaults.callDefaults.description')}
            </p>
          </div>
          <div className="w-full md:justify-self-end">
            <Textarea
              value={callDefaultsText}
              onChange={(event) => {
                setFormState({
                  ...activeForm,
                  callDefaultsText: event.target.value,
                  saveStatus: 'idle'
                })
              }}
              placeholder='{"temperature":0.7}'
              className={TEXTAREA_CLASS}
            />
          </div>
        </div>

        <div className={SETTINGS_FIELD_ROW_CLASS}>
          <div className="min-w-0 space-y-1">
            <Label className={LABEL_CLASS}>
              {t('providers.defaults.rawProviderOptions.label')}
            </Label>
            <p className="text-[0.625rem] leading-4 text-muted-foreground">
              {t('providers.defaults.rawProviderOptions.description')}
            </p>
          </div>
          <div className="w-full md:justify-self-end">
            <Textarea
              value={rawProviderOptionsText}
              onChange={(event) => {
                setFormState({
                  ...activeForm,
                  rawProviderOptionsText: event.target.value,
                  saveStatus: 'idle'
                })
              }}
              placeholder='{"openai":{"reasoningEffort":"medium"}}'
              className={TEXTAREA_CLASS}
            />
          </div>
        </div>

        {error ? <p className="px-4 py-2 text-[0.6875rem] text-destructive">{error}</p> : null}
      </ProviderSectionCard>

      <FloatingSaveBar visible={hasChanges} changeCount={changeCount} status={saveStatus}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={saveDefaults.isPending}
          className="h-8 rounded-xl px-3 text-xs"
        >
          <X className="mr-1 size-3.5" />
          {t('common.actions.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saveDefaults.isPending || !hasChanges || hasInvalidJson}
          className="h-8 rounded-xl px-3 text-xs"
        >
          {saveDefaults.isPending || saveStatus === 'saving' ? (
            <Spinner className="mr-1 size-3.5" />
          ) : saveStatus === 'success' ? (
            <CheckCircle2 className="mr-1 size-3.5" />
          ) : (
            <Save className="mr-1 size-3.5" />
          )}
          {saveStatus === 'success' ? t('common.actions.saved') : t('common.actions.save')}
        </Button>
      </FloatingSaveBar>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('providers.defaults.reset.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('providers.defaults.reset.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveDefaults.isPending}>
              {t('common.actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                handleReset()
              }}
              disabled={saveDefaults.isPending}
            >
              {t('providers.defaults.reset.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function OptionField({
  field,
  value,
  resetToken,
  onChange,
  onJsonInvalidChange
}: {
  field: ProviderOptionField
  value: unknown
  resetToken: number
  onChange: (value: unknown) => void
  onJsonInvalidChange: (invalid: boolean) => void
}) {
  const { t } = useTranslation()
  const stringValue = value === undefined || value === null ? '' : String(value)

  return (
    <div className={SETTINGS_FIELD_ROW_CLASS}>
      <div className="min-w-0 space-y-1">
        <Label className={LABEL_CLASS}>{field.label}</Label>
        {field.description ? (
          <p className="text-[0.625rem] leading-4 text-muted-foreground">{field.description}</p>
        ) : null}
      </div>
      <div className="w-full md:justify-self-end">
        {field.control === 'boolean' ? (
          <div className="flex min-h-9 items-center justify-end gap-2">
            <span className="text-[0.6875rem] text-muted-foreground">
              {typeof value === 'boolean' ? String(value) : t('providers.defaults.unset')}
            </span>
            <Switch
              size="sm"
              checked={value === true}
              onCheckedChange={(checked) => onChange(Boolean(checked))}
            />
          </div>
        ) : field.control === 'select' ? (
          <Select
            value={stringValue}
            onValueChange={(next) => {
              const selected = (field.choices ?? []).find((choice) => String(choice.value) === next)
              onChange(selected ? selected.value : next)
            }}
          >
            <SelectTrigger className={cn('w-full', INPUT_CLASS)}>
              <SelectValue placeholder={t('providers.defaults.unset')} />
            </SelectTrigger>
            <SelectContent>
              {(field.choices ?? []).map((choice) => (
                <SelectItem key={String(choice.value)} value={String(choice.value)}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : field.control === 'json' ? (
          <JsonOptionField
            key={resetToken}
            value={value}
            onChange={onChange}
            onInvalidChange={onJsonInvalidChange}
          />
        ) : (
          <Input
            type={field.control === 'number' ? 'number' : 'text'}
            min={field.min}
            max={field.max}
            step={field.step}
            value={Array.isArray(value) ? value.join(', ') : stringValue}
            onChange={(event) => {
              const next = event.target.value
              if (field.control === 'number') {
                const parsed = Number(next)
                onChange(next === '' || !Number.isFinite(parsed) ? undefined : parsed)
                return
              }
              if (field.control === 'string-list') {
                onChange(
                  next
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                )
                return
              }
              onChange(next)
            }}
            placeholder={field.description}
            className={INPUT_CLASS}
          />
        )}
      </div>
    </div>
  )
}

function JsonOptionField({
  value,
  onChange,
  onInvalidChange
}: {
  value: unknown
  onChange: (value: unknown) => void
  onInvalidChange: (invalid: boolean) => void
}) {
  const { t } = useTranslation()
  const external = value === undefined ? '' : JSON.stringify(value, null, 2)
  const [state, setState] = useState({
    external,
    draft: external,
    synced: external,
    invalid: false
  })
  const isExternalChanged = state.external !== external
  const draft = isExternalChanged ? external : state.draft
  const synced = isExternalChanged ? external : state.synced
  const invalid = isExternalChanged ? false : state.invalid

  useEffect(() => {
    if (!isExternalChanged) return
    onInvalidChange(false)
  }, [isExternalChanged, onInvalidChange])

  return (
    <div className="space-y-1">
      <Textarea
        value={draft}
        onChange={(event) => {
          const next = event.target.value
          if (next.trim() === '') {
            setState({ external, draft: next, synced: '', invalid: false })
            onChange(undefined)
            onInvalidChange(false)
            return
          }
          try {
            const parsed = JSON.parse(next)
            setState({
              external,
              draft: next,
              synced: JSON.stringify(parsed, null, 2),
              invalid: false
            })
            onChange(parsed)
            onInvalidChange(false)
          } catch {
            setState({ external, draft: next, synced, invalid: true })
            onInvalidChange(true)
          }
        }}
        placeholder={t('providers.defaults.unset')}
        className={cn(TEXTAREA_CLASS, invalid && 'border-destructive')}
      />
      {invalid ? (
        <p className="text-[0.625rem] leading-4 text-destructive">
          {t('providers.defaults.errors.objectRequired')}
        </p>
      ) : null}
    </div>
  )
}
