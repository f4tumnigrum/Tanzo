import { useMemo, useState } from 'react'
import { ChevronDown, RotateCcw, Type } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_TYPOGRAPHY,
  TYPOGRAPHY_CODE_FONT_SIZE_MAX,
  TYPOGRAPHY_CODE_FONT_SIZE_MIN,
  TYPOGRAPHY_FONT_SIZE_MAX,
  TYPOGRAPHY_FONT_SIZE_MIN,
  TYPOGRAPHY_LINE_HEIGHT_MAX,
  TYPOGRAPHY_LINE_HEIGHT_MIN,
  type TypographySettings
} from '@shared/preferences'
import { useThemeSettings } from '@/common/theme/store'
import {
  BUNDLED_MONO_FONTS,
  BUNDLED_SANS_FONTS,
  useLocalFonts,
  type FontOption
} from '@/common/theme/fonts'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { SectionCard } from '../shared/settings-primitives'

const CODE_SAMPLE = 'const greet = (name: string) => `Hi, ${name}!`'

function TypographyPreview({ typography }: { typography: TypographySettings }) {
  const { t } = useTranslation()
  const sans = typography.sansFont ?? 'var(--font-sans-ui)'
  const mono = typography.monoFont ?? 'var(--font-mono-ui)'

  return (
    <div className="flex w-full items-stretch gap-3.5 px-3.5 py-3.5">
      <div className="flex w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-muted/30 ring-1 ring-inset ring-border/15">
        <span
          className="leading-none text-foreground/90"
          style={{ fontFamily: sans, fontSize: '1.875rem' }}
        >
          Ag
        </span>
        <span className="text-[0.5625rem] tabular-nums tracking-[0.04em] text-foreground/40">
          {typography.fontSize}px · {typography.lineHeight.toFixed(2)}
        </span>
      </div>
      <div className="min-w-0 flex-1 self-center">
        <p
          className="m-0 break-words text-foreground/85 [text-wrap:pretty]"
          style={{
            fontFamily: sans,
            fontSize: `${typography.fontSize}px`,
            lineHeight: typography.lineHeight
          }}
        >
          {t('settings.theme.typography.sample', {
            defaultValue: 'The quick brown fox jumps over the lazy dog — 0123456789'
          })}
        </p>
        <div className="mt-2.5 mb-2 h-px bg-gradient-to-r from-border/40 via-border/15 to-transparent" />
        <code
          className="block truncate text-foreground/62"
          style={{ fontFamily: mono, fontSize: `${typography.codeFontSize}px` }}
        >
          {CODE_SAMPLE}
        </code>
      </div>
    </div>
  )
}

function FontCombobox({
  label,
  value,
  bundled,
  local,
  mono,
  onChange
}: {
  label: string
  value: string | null
  bundled: FontOption[]
  local: FontOption[]
  mono?: boolean
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const themeDefaultLabel = t('settings.theme.typography.themeDefault', {
    defaultValue: 'Theme default'
  })

  const localFiltered = useMemo(() => {
    const bundledValues = new Set(bundled.map((font) => font.value))
    return local.filter(
      (font) => !bundledValues.has(font.value) && (mono ? font.kind === 'mono' : true)
    )
  }, [bundled, local, mono])

  const selected = useMemo(
    () =>
      value === null
        ? null
        : (bundled.find((font) => font.value === value) ??
          localFiltered.find((font) => font.value === value) ??
            // A saved font missing from both lists (e.g. uninstalled) stays
            // visible and selectable so the preference is never silently lost.
            { value, label: value.split(',')[0].replace(/'/g, ''), kind: 'sans' as const }),
    [bundled, localFiltered, value]
  )

  const pick = (next: string | null) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="flex min-h-11 w-full items-center gap-4 px-3 py-2">
      <span className="w-24 shrink-0 text-[0.8125rem] text-foreground/82">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-[var(--radius-md)]',
            'bg-muted/25 px-2.5 text-[0.8125rem] ring-1 ring-inset ring-border/20',
            'transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/50 outline-none'
          )}
        >
          {selected === null ? (
            <span className="truncate text-foreground/55">{themeDefaultLabel}</span>
          ) : (
            <span className="truncate text-foreground/90" style={{ fontFamily: selected.value }}>
              {selected.label}
            </span>
          )}
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-foreground/35 transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-(--anchor-width) min-w-64 gap-0 p-0"
        >
          <Command>
            <CommandInput
              placeholder={t('settings.theme.typography.search', {
                defaultValue: 'Search fonts…'
              })}
            />
            <CommandList>
              <CommandEmpty>
                {t('settings.theme.typography.noResults', { defaultValue: 'No fonts found.' })}
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={themeDefaultLabel}
                  data-checked={value === null}
                  onSelect={() => pick(null)}
                >
                  <span className="text-foreground/70">{themeDefaultLabel}</span>
                </CommandItem>
              </CommandGroup>
              <CommandGroup
                heading={t('settings.theme.typography.bundled', { defaultValue: 'Bundled' })}
              >
                {bundled.map((font) => (
                  <CommandItem
                    key={font.value}
                    value={font.label}
                    data-checked={value === font.value}
                    onSelect={() => pick(font.value)}
                  >
                    <span style={{ fontFamily: font.value }}>{font.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {localFiltered.length > 0 ? (
                <CommandGroup
                  heading={t('settings.theme.typography.system', { defaultValue: 'System' })}
                >
                  {localFiltered.map((font) => (
                    <CommandItem
                      key={font.value}
                      value={font.label}
                      data-checked={value === font.value}
                      onSelect={() => pick(font.value)}
                    >
                      <span style={{ fontFamily: font.value }}>{font.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <span className="w-6 shrink-0">
        {value !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={t('settings.theme.typography.reset', { defaultValue: 'Reset' })}
            onClick={() => onChange(null)}
            className="rounded-full text-foreground/35 hover:text-foreground/75"
          >
            <RotateCcw className="size-3" />
          </Button>
        ) : null}
      </span>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-h-11 w-full items-center gap-4 px-3 py-2">
      <span className="w-24 shrink-0 text-[0.8125rem] text-foreground/82">{label}</span>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          if (typeof next === 'number') onChange(next)
        }}
      />
      <span className="flex h-6 w-14 shrink-0 items-center justify-center rounded-full bg-muted/35 text-[0.6875rem] tabular-nums text-foreground/65 ring-1 ring-inset ring-border/15">
        {display}
      </span>
      <span className="w-6 shrink-0" />
    </div>
  )
}

export function TypographySection() {
  const { t } = useTranslation()
  const { typography, patchTypography } = useThemeSettings()
  const localFonts = useLocalFonts()

  const isDefault =
    typography.fontSize === DEFAULT_TYPOGRAPHY.fontSize &&
    typography.codeFontSize === DEFAULT_TYPOGRAPHY.codeFontSize &&
    typography.lineHeight === DEFAULT_TYPOGRAPHY.lineHeight &&
    typography.sansFont === DEFAULT_TYPOGRAPHY.sansFont &&
    typography.monoFont === DEFAULT_TYPOGRAPHY.monoFont

  return (
    <SectionCard
      icon={<Type className="size-3" />}
      title={t('settings.theme.typography.title', { defaultValue: 'Typography' })}
      description={t('settings.theme.typography.description', {
        defaultValue: 'Fonts, sizes, and line height.'
      })}
      action={
        !isDefault ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-foreground/55 hover:text-foreground/85"
            onClick={() => void patchTypography({ ...DEFAULT_TYPOGRAPHY })}
          >
            <RotateCcw className="size-3" />
            {t('settings.theme.typography.reset', { defaultValue: 'Reset' })}
          </Button>
        ) : undefined
      }
    >
      <TypographyPreview typography={typography} />
      <FontCombobox
        label={t('settings.theme.typography.sansFont', { defaultValue: 'Interface font' })}
        value={typography.sansFont}
        bundled={BUNDLED_SANS_FONTS}
        local={localFonts}
        onChange={(sansFont) => void patchTypography({ sansFont })}
      />
      <FontCombobox
        label={t('settings.theme.typography.monoFont', { defaultValue: 'Code font' })}
        value={typography.monoFont}
        bundled={BUNDLED_MONO_FONTS}
        local={localFonts}
        mono
        onChange={(monoFont) => void patchTypography({ monoFont })}
      />
      <SliderRow
        label={t('settings.theme.typography.fontSize', { defaultValue: 'Font size' })}
        value={typography.fontSize}
        min={TYPOGRAPHY_FONT_SIZE_MIN}
        max={TYPOGRAPHY_FONT_SIZE_MAX}
        step={0.5}
        display={`${typography.fontSize}px`}
        onChange={(fontSize) => void patchTypography({ fontSize })}
      />
      <SliderRow
        label={t('settings.theme.typography.codeFontSize', { defaultValue: 'Code size' })}
        value={typography.codeFontSize}
        min={TYPOGRAPHY_CODE_FONT_SIZE_MIN}
        max={TYPOGRAPHY_CODE_FONT_SIZE_MAX}
        step={0.5}
        display={`${typography.codeFontSize}px`}
        onChange={(codeFontSize) => void patchTypography({ codeFontSize })}
      />
      <SliderRow
        label={t('settings.theme.typography.lineHeight', { defaultValue: 'Line height' })}
        value={typography.lineHeight}
        min={TYPOGRAPHY_LINE_HEIGHT_MIN}
        max={TYPOGRAPHY_LINE_HEIGHT_MAX}
        step={0.02}
        display={typography.lineHeight.toFixed(2)}
        onChange={(lineHeight) => void patchTypography({ lineHeight })}
      />
    </SectionCard>
  )
}
