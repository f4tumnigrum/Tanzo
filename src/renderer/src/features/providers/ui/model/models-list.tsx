import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, ChevronLeft, ChevronRight, RefreshCw, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
import { cn } from '@/lib/utils'
import type {
  ModelFamily,
  ProviderFamilyState,
  ProviderId,
  StoredProviderModel
} from '@/common/contracts'
import {
  useDeleteProviderModel,
  useSaveProviderModelState,
  useSyncProviderModels
} from '../../model'
import { AddModelDialog } from './add-model-dialog'
import { ProviderSectionCard } from '../provider-detail/provider-section'

const ITEMS_PER_PAGE = 10
const PAGINATION_MAX_VISIBLE = 5

const MODEL_META_PILL_CLASS = [
  'inline-flex h-5 shrink-0 items-center justify-center rounded-md border-0 px-2',
  'text-[0.625rem] font-medium leading-none shadow-none'
].join(' ')

const MODEL_META_PILL_TONES = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary'
} as const

interface ModelsListProps {
  providerId: ProviderId
  family: ModelFamily
  state: ProviderFamilyState
}

function buildPageNumbers(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= PAGINATION_MAX_VISIBLE + 2) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const pages: (number | 'ellipsis')[] = [1]
  const windowStart = Math.max(2, currentPage - 1)
  const windowEnd = Math.min(totalPages - 1, currentPage + 1)
  if (windowStart > 2) pages.push('ellipsis')
  for (let page = windowStart; page <= windowEnd; page += 1) pages.push(page)
  if (windowEnd < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}

export function ModelsList({ providerId, family, state }: ModelsListProps) {
  const paginationKey = `${providerId}:${family}`
  const { t } = useTranslation()
  const syncModels = useSyncProviderModels(providerId)
  const saveModelState = useSaveProviderModelState(providerId)
  const deleteModel = useDeleteProviderModel(providerId)
  const [pagination, setPagination] = useState({ key: paginationKey, page: 1 })
  const [pendingDelete, setPendingDelete] = useState<StoredProviderModel | null>(null)
  const page = pagination.key === paginationKey ? pagination.page : 1

  const totalModels = state.models.length
  const totalPages = Math.max(1, Math.ceil(totalModels / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalModels)

  const pageModels = useMemo(
    () => state.models.slice(startIndex, endIndex),
    [endIndex, startIndex, state.models]
  )
  const pageNumbers = useMemo(() => buildPageNumbers(safePage, totalPages), [safePage, totalPages])

  const enabledCount = state.enabledModelCount
  const disabledCount = state.modelCount - enabledCount
  const isMutating = saveModelState.isPending
  const canSyncModels = state.descriptor.modelDiscoveryStrategy === 'api'

  function toggleModel(model: StoredProviderModel, enabled: boolean) {
    saveModelState.mutate({ family, modelId: model.id, enabled })
  }

  function setDefault(model: StoredProviderModel) {
    saveModelState.mutate({ family, modelId: model.id, enabled: true, isDefault: true })
  }

  function bulkSetEnabled(target: boolean) {
    void (async () => {
      for (const model of state.models) {
        if (model.enabled === target) continue
        try {
          await saveModelState.mutateAsync({ family, modelId: model.id, enabled: target })
        } catch {
          break
        }
      }
    })()
  }

  function confirmDelete() {
    if (!pendingDelete) return
    deleteModel.mutate(
      { family, modelId: pendingDelete.id },
      { onSuccess: () => setPendingDelete(null) }
    )
  }

  function renderMetaBadge(model: StoredProviderModel, value: string, editable = false) {
    if (editable) {
      return (
        <AddModelDialog
          key={value}
          providerId={providerId}
          family={family}
          model={model}
          triggerElement={
            <button
              type="button"
              className={cn(
                MODEL_META_PILL_CLASS,
                MODEL_META_PILL_TONES.primary,
                'cursor-pointer font-mono transition-opacity hover:opacity-80'
              )}
            />
          }
        >
          {value}
        </AddModelDialog>
      )
    }

    return (
      <Badge
        key={value}
        className={cn(MODEL_META_PILL_CLASS, MODEL_META_PILL_TONES.primary, 'font-mono')}
      >
        {value}
      </Badge>
    )
  }

  return (
    <section className="space-y-2">
      <ProviderSectionCard
        icon={Boxes}
        title={t('providers.models.list.title')}
        description={t('providers.models.list.enabledCount', {
          enabled: enabledCount,
          total: state.modelCount
        })}
        action={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => bulkSetEnabled(true)}
              disabled={disabledCount === 0 || isMutating}
              className="h-7 rounded-xl px-2.5 text-[0.6875rem]"
            >
              {t('providers.models.bulk.enableAll')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => bulkSetEnabled(false)}
              disabled={enabledCount === 0 || isMutating}
              className="h-7 rounded-xl px-2.5 text-[0.6875rem]"
            >
              {t('providers.models.bulk.disableAll')}
            </Button>
            {canSyncModels ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => syncModels.mutate(family)}
                disabled={syncModels.isPending}
                className="h-7 gap-1.5 rounded-xl px-2.5 text-[0.6875rem]"
              >
                <RefreshCw className={cn('size-3.5', syncModels.isPending && 'animate-spin')} />
                {t('providers.models.list.sync')}
              </Button>
            ) : null}
            <AddModelDialog providerId={providerId} family={family} />
          </>
        }
      >
        {totalModels === 0 ? (
          <div className="px-3 py-8 text-center text-[0.6875rem] text-muted-foreground">
            {t('providers.models.list.empty')}
          </div>
        ) : (
          pageModels.map((model) => (
            <div
              key={model.id}
              className="group flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-[0.8125rem] font-medium text-foreground/90">
                    {model.name}
                  </span>
                  {model.isCustom ? (
                    <AddModelDialog
                      providerId={providerId}
                      family={family}
                      model={model}
                      triggerElement={
                        <button
                          type="button"
                          className={cn(
                            MODEL_META_PILL_CLASS,
                            MODEL_META_PILL_TONES.neutral,
                            'cursor-pointer transition-opacity hover:opacity-80'
                          )}
                        />
                      }
                    >
                      {t('providers.models.badges.custom')}
                    </AddModelDialog>
                  ) : null}
                  <AddModelDialog
                    providerId={providerId}
                    family={family}
                    model={model}
                    triggerElement={
                      <button
                        type="button"
                        className={cn(
                          MODEL_META_PILL_CLASS,
                          MODEL_META_PILL_TONES.neutral,
                          'cursor-pointer transition-opacity hover:opacity-80'
                        )}
                      />
                    }
                  >
                    {model.source}
                  </AddModelDialog>
                  {model.contextWindow
                    ? renderMetaBadge(
                        model,
                        t('providers.models.meta.contextWindow', {
                          value: model.contextWindow.toLocaleString()
                        }),
                        true
                      )
                    : null}
                  {model.maxOutput
                    ? renderMetaBadge(
                        model,
                        t('providers.models.meta.maxOutput', {
                          value: model.maxOutput.toLocaleString()
                        }),
                        true
                      )
                    : null}
                  {model.dimensions
                    ? renderMetaBadge(
                        model,
                        t('providers.models.meta.dimensions', {
                          value: model.dimensions.toLocaleString()
                        })
                      )
                    : null}
                  {model.maxImagesPerCall
                    ? renderMetaBadge(
                        model,
                        t('providers.models.meta.images', { value: model.maxImagesPerCall })
                      )
                    : null}
                  {model.supportedSizes?.length
                    ? renderMetaBadge(model, model.supportedSizes.slice(0, 3).join(', '))
                    : null}
                  {model.supportedFormats?.length
                    ? renderMetaBadge(model, model.supportedFormats.slice(0, 3).join(', '))
                    : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant={model.isDefault ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setDefault(model)}
                  disabled={isMutating}
                  className={cn(
                    'h-8 rounded-xl px-2.5 text-[0.6875rem]',
                    !model.isDefault && 'text-muted-foreground'
                  )}
                >
                  <Star className={cn('mr-1 size-3.5', model.isDefault && 'fill-current')} />
                  {model.isDefault
                    ? t('providers.models.actions.default')
                    : t('providers.models.actions.setDefault')}
                </Button>
                <Switch
                  size="sm"
                  checked={Boolean(model.enabled)}
                  onCheckedChange={(checked) => toggleModel(model, Boolean(checked))}
                  disabled={isMutating}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setPendingDelete(model)}
                  disabled={isMutating || deleteModel.isPending}
                  className="size-8 rounded-xl text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </ProviderSectionCard>

      {totalModels > 0 && totalPages > 1 ? (
        <div className="flex flex-col gap-2 px-1 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.6875rem] text-muted-foreground">
            {t('providers.models.pagination.showing', {
              start: startIndex + 1,
              end: endIndex,
              total: totalModels
            })}
          </p>
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setPagination({ key: paginationKey, page: Math.max(1, safePage - 1) })}
              disabled={safePage === 1}
              className="rounded-xl"
            >
              <ChevronLeft className="size-4" />
            </Button>
            {pageNumbers.map((item, index) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-1 text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  type="button"
                  variant={item === safePage ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  onClick={() => setPagination({ key: paginationKey, page: item })}
                  className="rounded-xl text-[0.6875rem]"
                >
                  {item}
                </Button>
              )
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                setPagination({ key: paginationKey, page: Math.min(totalPages, safePage + 1) })
              }
              disabled={safePage === totalPages}
              className="rounded-xl"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('providers.models.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('providers.models.delete.description', { name: pendingDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t('common.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
