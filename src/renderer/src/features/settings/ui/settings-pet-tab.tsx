import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PetSummary } from '@shared/pet'
import { PET_SCALE_MAX, PET_SCALE_MIN } from '@shared/preferences'
import { petClient } from '@/platform/electron/pet-client'
import { patchPreferences, usePreferences } from '@/common/preferences'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { SectionCard } from './shared/settings-primitives'
import { ThemeOptionRow } from './theme/theme-option-row'
import { PetSpritePreview } from './pet/pet-sprite-preview'

const PETS_PER_PAGE = 8

export function SettingsPetTab(): React.JSX.Element {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const [pets, setPets] = useState<PetSummary[]>([])
  const [page, setPage] = useState(0)

  useEffect(() => {
    let cancelled = false
    void petClient.list().then((list) => {
      if (!cancelled) setPets(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const pageCount = Math.max(1, Math.ceil(pets.length / PETS_PER_PAGE))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * PETS_PER_PAGE
  const visiblePets = pets.slice(start, start + PETS_PER_PAGE)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <SectionCard
        icon={<Sparkles className="size-3" />}
        title={t('settings.pet.title', { defaultValue: 'Desktop Pet' })}
        description={t('settings.pet.description', {
          defaultValue: 'Show a floating companion that reflects agent activity.'
        })}
      >
        <div className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5">
          <span className="text-[0.8125rem] text-foreground/82">
            {t('settings.pet.enable', { defaultValue: 'Enable desktop pet' })}
          </span>
          <Switch
            checked={preferences.petEnabled}
            onCheckedChange={(checked) => {
              void patchPreferences({
                petEnabled: checked,
                ...(checked && !preferences.petId && pets[0] ? { petId: pets[0].id } : {})
              })
            }}
          />
        </div>
        <div className="flex min-h-11 w-full items-center gap-4 px-3 py-2.5">
          <span className="shrink-0 text-[0.8125rem] text-foreground/82">
            {t('settings.pet.size.title', { defaultValue: 'Size' })}
          </span>
          <Slider
            value={preferences.petScale}
            min={PET_SCALE_MIN}
            max={PET_SCALE_MAX}
            step={0.05}
            disabled={!preferences.petEnabled}
            onValueChange={(value) => {
              if (typeof value === 'number') void patchPreferences({ petScale: value })
            }}
          />
          <span className="w-10 shrink-0 text-right text-[0.6875rem] tabular-nums text-foreground/52">
            {Math.round(preferences.petScale * 100)}%
          </span>
        </div>
      </SectionCard>

      <div className="space-y-1.5">
        <SectionCard
          icon={<Sparkles className="size-3" />}
          title={t('settings.pet.choose', { defaultValue: 'Pet' })}
          description={t('settings.pet.chooseDescription', {
            defaultValue: 'Pick which companion appears on your desktop.'
          })}
        >
          {pets.length === 0 ? (
            <div className="flex min-h-11 w-full items-center px-3 py-1.5 text-[0.6875rem] text-foreground/52">
              {t('settings.pet.empty', {
                defaultValue: 'No pets found in ~/.tanzo/pets or ~/.codex/pets'
              })}
            </div>
          ) : (
            visiblePets.map((pet) => (
              <ThemeOptionRow
                key={pet.id}
                label={pet.displayName}
                description={pet.description}
                selected={preferences.petId === pet.id}
                onClick={() => void patchPreferences({ petId: pet.id })}
                preview={<PetSpritePreview petId={pet.id} />}
                previewClassName="size-12 p-0"
              />
            ))
          )}
        </SectionCard>
        {pageCount > 1 ? (
          <div className="flex items-center justify-end gap-2 px-1 pt-0.5">
            <span className="text-[0.6875rem] tabular-nums text-foreground/52">
              {t('settings.pet.page', {
                defaultValue: 'Page {{page}} of {{pageCount}}',
                page: currentPage + 1,
                pageCount
              })}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
