import { RefreshCw, Store, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MarketplaceSourceSummary } from '@shared/plugins'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'

export function ManageMarketplacesDialog({
  open,
  sources,
  removingName,
  upgradingName,
  onOpenChange,
  onRemove,
  onUpgrade
}: {
  open: boolean
  sources: MarketplaceSourceSummary[]
  removingName: string | undefined
  upgradingName: string | undefined
  onOpenChange: (open: boolean) => void
  onRemove: (name: string) => Promise<void>
  onUpgrade: (name: string) => Promise<void>
}): React.ReactElement {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('plugins.marketplace.manage.title')}</DialogTitle>
        </DialogHeader>

        {sources.length === 0 ? (
          <EmptyState
            icon={Store}
            title={t('plugins.marketplace.manage.empty.title')}
            description={t('plugins.marketplace.manage.empty.description')}
          />
        ) : (
          <ul className="-mx-2 max-h-[60vh] overflow-y-auto">
            {sources.map((source) => (
              <MarketplaceSourceRow
                key={source.name}
                source={source}
                removing={removingName === source.name}
                upgrading={upgradingName === source.name}
                onRemove={() => void onRemove(source.name)}
                onUpgrade={() => void onUpgrade(source.name)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MarketplaceSourceRow({
  source,
  removing,
  upgrading,
  onRemove,
  onUpgrade
}: {
  source: MarketplaceSourceSummary
  removing: boolean
  upgrading: boolean
  onRemove: () => void
  onUpgrade: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const isGit = source.sourceType === 'git'
  const busy = removing || upgrading

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium">{source.name}</span>
        <p className="truncate text-xs text-muted-foreground" title={source.source}>
          {source.refName ? `${source.source}#${source.refName}` : source.source}
        </p>
      </div>
      {isGit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onUpgrade}
          disabled={busy}
          aria-label={t('plugins.marketplace.manage.actions.upgrade')}
        >
          {upgrading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        disabled={busy}
        aria-label={t('plugins.marketplace.manage.actions.remove')}
      >
        {removing ? <Spinner className="size-3.5" /> : <Trash2 className="size-3.5" />}
      </Button>
    </li>
  )
}
