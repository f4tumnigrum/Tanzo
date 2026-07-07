import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AddMarketplaceInput } from '@shared/plugins'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

function looksLikeGit(raw: string): boolean {
  const value = raw.trim()
  if (!value) return true
  return !(
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.startsWith('/') ||
    value.startsWith('.\\') ||
    value.startsWith('..\\') ||
    value === '.' ||
    value === '..' ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('\\\\')
  )
}

export function AddMarketplaceDialog({
  open,
  adding,
  onOpenChange,
  onAdd
}: {
  open: boolean
  adding: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (input: AddMarketplaceInput) => Promise<void>
}): React.ReactElement {
  const { t } = useTranslation()
  const [source, setSource] = useState('')
  const [refName, setRefName] = useState('')
  const [sparse, setSparse] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isGit = useMemo(() => looksLikeGit(source), [source])

  const reset = (): void => {
    setSource('')
    setRefName('')
    setSparse('')
    setError(null)
  }

  const add = async (): Promise<void> => {
    const trimmedSource = source.trim()
    if (!trimmedSource) {
      setError(t('plugins.marketplace.add.errors.sourceRequired'))
      return
    }
    setError(null)
    const sparsePaths = sparse
      .split(/[\n,]/)
      .map((path) => path.trim())
      .filter(Boolean)
    try {
      await onAdd({
        source: trimmedSource,
        ...(isGit && refName.trim() ? { refName: refName.trim() } : {}),
        ...(isGit && sparsePaths.length > 0 ? { sparsePaths } : {})
      })
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plugins.marketplace.add.errors.addFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('plugins.marketplace.add.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="marketplace-source">{t('plugins.marketplace.add.source.label')}</Label>
            <Input
              id="marketplace-source"
              value={source}
              onChange={(event) => {
                setSource(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !adding) void add()
              }}
              placeholder={t('plugins.marketplace.add.source.placeholder')}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t('plugins.marketplace.add.source.hint')}
            </p>
          </div>

          {isGit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="marketplace-ref">{t('plugins.marketplace.add.ref.label')}</Label>
                <Input
                  id="marketplace-ref"
                  value={refName}
                  onChange={(event) => setRefName(event.target.value)}
                  placeholder={t('plugins.marketplace.add.ref.placeholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="marketplace-sparse">
                  {t('plugins.marketplace.add.sparse.label')}
                </Label>
                <Input
                  id="marketplace-sparse"
                  value={sparse}
                  onChange={(event) => setSparse(event.target.value)}
                  placeholder={t('plugins.marketplace.add.sparse.placeholder')}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </pre>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" className="min-w-24" onClick={add} disabled={adding}>
            {adding ? <Spinner className="size-4" /> : null}
            {t('plugins.marketplace.add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
