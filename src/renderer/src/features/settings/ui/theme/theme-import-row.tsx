import { useState, type KeyboardEvent } from 'react'
import { Import } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { importTweakcnTheme, useCustomThemes } from '@/common/theme/custom-themes'
import { useThemeSettings } from '@/common/theme/store'

export function ThemeImportRow() {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addTheme } = useCustomThemes()
  const { setColorThemeId } = useThemeSettings()

  const handleImport = async () => {
    const trimmed = url.trim()
    if (!trimmed || loading) return
    setLoading(true)
    setError(null)
    try {
      const theme = await importTweakcnTheme(trimmed)
      await addTheme(theme)
      void setColorThemeId(theme.id)
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.theme.colors.import.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleImport()
    }
  }

  return (
    <div className="space-y-1.5 px-3 py-2">
      <div className="flex items-center gap-2">
        <Input
          type="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('settings.theme.colors.import.placeholder', {
            defaultValue: 'https://tweakcn.com/r/themes/...'
          })}
          disabled={loading}
          className={cn(
            'h-7 rounded-[var(--radius-md)] border-transparent bg-muted/35 px-2.5 ring-1 ring-inset ring-border/15',
            'text-[0.6875rem] tracking-[0.01em] placeholder:text-foreground/40',
            'focus-visible:ring-1 focus-visible:ring-primary/40'
          )}
        />
        <Button
          type="button"
          onClick={() => void handleImport()}
          disabled={loading || url.trim().length === 0}
          size="sm"
          className="h-7 rounded-[var(--radius-md)] px-3 text-[0.6875rem] font-medium tracking-[0.01em]"
        >
          {loading ? <Spinner className="size-3" /> : <Import className="size-3" />}
          {t('settings.theme.colors.actions.import', { defaultValue: 'Import' })}
        </Button>
      </div>
      {error ? <p className="text-[0.625rem] tracking-[0.01em] text-red-500/78">{error}</p> : null}
    </div>
  )
}
